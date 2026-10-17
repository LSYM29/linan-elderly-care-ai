"use strict";
const { setTimeout: delay } = require("node:timers/promises");
const { tools } = require("./tools");
const names = new Set(tools.map((t) => t.function.name));
let active = 0;
const messages = {
  MODEL_NOT_CONFIGURED:
    "尚未配置 DeepSeek API Key，请在本地 .env 中填写后重启系统",
  MODEL_CONFIG: "模型接口配置不正确，请检查 .env 中的 API 地址和模型名称",
  MODEL_AUTH: "DeepSeek 密钥无效或已停用，请检查本地 .env 后重启",
  MODEL_BALANCE: "DeepSeek 账户余额不足，请在官方开放平台检查余额",
  MODEL_RATE_LIMIT: "模型接口请求过于频繁，请稍后重试",
  MODEL_BUSY: "模型正在处理其他请求，请稍后重试",
  MODEL_TIMEOUT: "模型响应超时，请稍后重试；预约不会自动提交",
  MODEL_NETWORK: "暂时无法连接模型接口，请检查网络后重试",
  MODEL_FAILED: "模型接口暂时不可用，请稍后重试",
  MODEL_INVALID_JSON: "模型返回格式不正确，请重试；预约不会自动提交",
  MODEL_TRUNCATED: "模型回答未完整返回，请缩小问题范围后重试",
  MODEL_UNEXPECTED_TOOL: "模型请求了不支持的操作，已阻止执行",
};
function modelError(code) {
  return Object.assign(new Error(messages[code] || messages.MODEL_FAILED), {
    code,
    status: 503,
  });
}
function config(env = process.env) {
  const key = (env.DEEPSEEK_API_KEY || "").trim();
  if (!key || /请填写|your[_ -]?key|填入|change[_ -]?me/i.test(key))
    throw modelError("MODEL_NOT_CONFIGURED");
  if (/[\r\n\s]/.test(key)) throw modelError("MODEL_CONFIG");
  let url;
  try {
    url = new URL(
      (env.AI_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, "") +
        "/chat/completions",
    );
  } catch {
    throw modelError("MODEL_CONFIG");
  }
  const localMock =
    env.AI_ALLOW_LOCAL_HTTP === "1" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (!localMock && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw modelError("MODEL_CONFIG");
  if (env.AI_PROVIDER && env.AI_PROVIDER !== "deepseek")
    throw modelError("MODEL_CONFIG");
  const model = (env.AI_MODEL || "deepseek-flash").trim();
  if (!/^[\w.:-]{1,100}$/.test(model)) throw modelError("MODEL_CONFIG");
  const clamp = (value, fallback, min, max) =>
    Math.min(max, Math.max(min, Number(value) || fallback));
  return {
    key,
    url: url.href,
    model,
    timeout: clamp(env.AI_TIMEOUT_MS, 45000, 100, 120000),
    maxTokens: clamp(env.AI_MAX_TOKENS, 2048, 128, 8192),
    retries: env.AI_RETRIES === "0" ? 0 : 1,
  };
}
function isConfigured() {
  try {
    config();
    return true;
  } catch {
    return false;
  }
}
async function boundedJson(response) {
  // Never read unlimited bodies or echo upstream errors, which may contain secrets.
  if (Number(response.headers.get("content-length")) > 1024 * 1024) {
    await response.body?.cancel();
    throw modelError("MODEL_INVALID_JSON");
  }
  const reader = response.body?.getReader();
  if (!reader) throw modelError("MODEL_INVALID_JSON");
  const chunks = [];
  let bytes = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    bytes += part.value.byteLength;
    if (bytes > 1024 * 1024) {
      await reader.cancel();
      throw modelError("MODEL_INVALID_JSON");
    }
    chunks.push(Buffer.from(part.value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw modelError("MODEL_INVALID_JSON");
  }
}
function toolResult(call, usage, model) {
  return {
    data: {
      kind: "tool",
      tool: call.function.name,
      arguments: call.function.arguments,
      answer: "",
      citations: [],
    },
    toolCallId: call.id,
    usage,
    model,
  };
}
function validateCall(call) {
  if (
    !call ||
    call.type !== "function" ||
    typeof call.id !== "string" ||
    !call.id ||
    !names.has(call.function?.name) ||
    typeof call.function.arguments !== "string" ||
    call.function.arguments.length > 12000
  )
    throw modelError("MODEL_UNEXPECTED_TOOL");
  let args;
  try {
    args = JSON.parse(call.function.arguments);
  } catch {
    throw modelError("MODEL_INVALID_JSON");
  }
  if (!args || typeof args !== "object" || Array.isArray(args))
    throw modelError("MODEL_INVALID_JSON");
  const schema = tools.find((t) => t.function.name === call.function.name)
    .function.parameters;
  if (
    Object.keys(args).some((key) => !Object.hasOwn(schema.properties, key)) ||
    schema.required.some((key) => !Object.hasOwn(args, key))
  )
    throw modelError("MODEL_UNEXPECTED_TOOL");
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key];
    if (
      (rule.type === "string" &&
        (typeof value !== "string" ||
          value.length > (rule.maxLength || 2000))) ||
      (rule.type === "integer" && (!Number.isSafeInteger(value) || value < 1))
    )
      throw modelError("MODEL_UNEXPECTED_TOOL");
  }
  return {
    id: call.id,
    type: "function",
    function: { name: call.function.name, arguments: call.function.arguments },
  };
}
async function complete(prompt, state = {}) {
  const cfg = config();
  // Batches execute serially through server permissions. Every tool_call_id
  // gets a result before the following HTTP request. No tool submits an order.
  if (state.pending?.length)
    return toolResult(state.pending.shift(), null, cfg.model);
  if (active >= 2) throw modelError("MODEL_BUSY");
  if (!state.messages) {
    const split = prompt.indexOf("\n<data>");
    state.messages =
      split < 0
        ? [{ role: "user", content: prompt }]
        : [
            { role: "system", content: prompt.slice(0, split) },
            {
              role: "user",
              content: prompt.slice(split + 7).replace(/<\/data>$/, ""),
            },
          ];
  }
  const body = JSON.stringify({
    model: cfg.model,
    messages: state.messages,
    tools,
    tool_choice: "auto",
    response_format: { type: "json_object" },
    thinking: { type: "disabled" },
    max_tokens: cfg.maxTokens,
    temperature: 0.2,
    stream: false,
  });
  if (Buffer.byteLength(body) > 200000) throw modelError("MODEL_CONFIG");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeout);
  active++;
  try {
    let response;
    for (let attempt = 0; attempt <= cfg.retries; attempt++) {
      try {
        response = await fetch(cfg.url, {
          method: "POST",
          headers: {
            Authorization: "Bearer " + cfg.key,
            "Content-Type": "application/json",
          },
          body,
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        const networkCode = error.cause?.code || error.code;
        const retryable = [
          "ECONNRESET",
          "ETIMEDOUT",
          "EAI_AGAIN",
          "UND_ERR_CONNECT_TIMEOUT",
          "UND_ERR_SOCKET",
        ].includes(networkCode);
        if (controller.signal.aborted || !retryable || attempt === cfg.retries)
          throw error;
        await delay(400, undefined, { signal: controller.signal });
        continue;
      }
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt === cfg.retries) break;
      const seconds = Number(response.headers.get("retry-after"));
      await response.body?.cancel();
      await delay(
        Math.min(
          2000,
          Math.max(200, Number.isFinite(seconds) ? seconds * 1000 : 400),
        ),
        undefined,
        { signal: controller.signal },
      );
    }
    if (!response.ok) {
      const code =
        {
          401: "MODEL_AUTH",
          403: "MODEL_AUTH",
          402: "MODEL_BALANCE",
          429: "MODEL_RATE_LIMIT",
          400: "MODEL_CONFIG",
          404: "MODEL_CONFIG",
        }[response.status] || "MODEL_FAILED";
      await response.body?.cancel();
      throw modelError(code);
    }
    const result = await boundedJson(response);
    const choice = result.choices?.[0];
    if (choice?.finish_reason === "length") throw modelError("MODEL_TRUNCATED");
    if (
      !["stop", "tool_calls"].includes(choice?.finish_reason) ||
      choice.message?.role !== "assistant"
    )
      throw modelError("MODEL_INVALID_JSON");
    const nonNegative = (n) =>
      Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
    const usage = {
      input_tokens: nonNegative(result.usage?.prompt_tokens),
      output_tokens: nonNegative(result.usage?.completion_tokens),
      cached_input_tokens: nonNegative(
        result.usage?.prompt_cache_hit_tokens ??
          result.usage?.prompt_tokens_details?.cached_tokens,
      ),
    };
    const calls = choice.message.tool_calls || [];
    if (!Array.isArray(calls) || calls.length > 4)
      throw modelError("MODEL_UNEXPECTED_TOOL");
    if (calls.length) {
      if (choice.finish_reason !== "tool_calls")
        throw modelError("MODEL_INVALID_JSON");
      const safe = calls.map(validateCall);
      if (
        new Set(safe.map((c) => c.id)).size !== safe.length ||
        safe.filter((c) => c.function.name === "prepare_booking").length > 1
      )
        throw modelError("MODEL_UNEXPECTED_TOOL");
      state.messages.push({
        role: "assistant",
        content: null,
        tool_calls: safe,
      });
      state.pending = safe.slice(1);
      return toolResult(safe[0], usage, cfg.model);
    }
    if (choice.finish_reason !== "stop") throw modelError("MODEL_INVALID_JSON");
    let data;
    try {
      data = JSON.parse(choice.message.content);
    } catch {
      throw modelError("MODEL_INVALID_JSON");
    }
    if (
      !data ||
      data.kind !== "reply" ||
      typeof data.answer !== "string" ||
      !data.answer.trim() ||
      data.answer.length > 8000 ||
      data.tool !== "" ||
      data.arguments !== "{}" ||
      !Array.isArray(data.citations) ||
      data.citations.length > 20 ||
      data.citations.some((c) => typeof c !== "string" || c.length > 150)
    )
      throw modelError("MODEL_INVALID_JSON");
    return { data, usage, model: cfg.model };
  } catch (error) {
    if (controller.signal.aborted) throw modelError("MODEL_TIMEOUT");
    if (error.code?.startsWith("MODEL_")) throw error;
    throw modelError("MODEL_NETWORK");
  } finally {
    clearTimeout(timer);
    active--;
  }
}
module.exports = { complete, isConfigured, config };
