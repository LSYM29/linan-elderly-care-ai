"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { setTimeout: delay } = require("node:timers/promises");
const { complete, config } = require("../src/ai/model");
const { databaseName } = require("../src/database-config");
const reply = {
  kind: "reply",
  answer: "服务以系统当前价格为准。",
  tool: "",
  arguments: "{}",
  citations: [],
};
function completion(content = reply, extra = {}) {
  return {
    choices: [
      {
        finish_reason: "stop",
        message: { role: "assistant", content: JSON.stringify(content) },
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_cache_hit_tokens: 30,
    },
    ...extra,
  };
}
const call = (name, args = {}, id = "call-1") => ({
  id,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});
function toolCompletion(calls) {
  return completion(null, {
    choices: [
      {
        finish_reason: "tool_calls",
        message: { role: "assistant", content: null, tool_calls: calls },
      },
    ],
  });
}
test("DeepSeek HTTP adapter: local fixtures only, no billable requests", async (t) => {
  const original = { ...process.env };
  let handler;
  let requests = [];
  const server = http.createServer(async (req, res) => {
    try {
      let raw = "";
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      requests.push({
        body,
        authorization: req.headers.authorization,
        path: req.url,
      });
      await handler(req, res, body);
    } catch {
      if (!res.destroyed) {
        res.statusCode = 500;
        res.end();
      }
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port + "/v1";
  const ok = (_, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(completion()));
  };
  const error = (code) => (_, res) => {
    res.statusCode = code;
    res.end("fake-secret-must-not-escape");
  };
  const fails = (code, promise = () => complete("按 JSON 回答")) =>
    assert.rejects(
      promise,
      (e) => e.code === code && !e.message.includes("fake-secret"),
    );
  let passed = 0;
  async function check(name, fn) {
    await t.test(name, async () => {
      Object.assign(process.env, {
        AI_PROVIDER: "deepseek",
        AI_BASE_URL: url,
        AI_ALLOW_LOCAL_HTTP: "1",
        AI_MODEL: "deepseek-flash",
        DEEPSEEK_API_KEY: "synthetic-test-only-key",
        AI_TIMEOUT_MS: "2000",
        AI_RETRIES: "0",
      });
      requests = [];
      handler = ok;
      await fn();
      passed++;
    });
  }
  try {
    await check("missing key fails before any network request", async () => {
      process.env.DEEPSEEK_API_KEY = "";
      await fails("MODEL_NOT_CONFIGURED");
      assert.equal(requests.length, 0);
    });
    await check(
      "reject insecure remote endpoint and embedded credentials",
      async () => {
        assert.throws(
          () =>
            config({
              DEEPSEEK_API_KEY: "fake",
              AI_BASE_URL: "http://example.com",
            }),
          /配置/,
        );
        assert.throws(
          () =>
            config({
              DEEPSEEK_API_KEY: "fake",
              AI_BASE_URL: "https://user:pass@example.com",
            }),
          /配置/,
        );
        assert.throws(
          () => config({ DEEPSEEK_API_KEY: "fake", AI_PROVIDER: "unsupported" }),
          /配置/,
        );
      },
    );
    await check(
      "HTTPS POST, Bearer header, JSON mode, tools and usage contract",
      async () => {
        const r = await complete('规则\n<data>{"question":"服务"}</data>');
        assert.equal(r.data.answer, reply.answer);
        assert.deepEqual(r.usage, {
          input_tokens: 100,
          output_tokens: 20,
          cached_input_tokens: 30,
        });
        const request = requests[0];
        assert.equal(request.path, "/v1/chat/completions");
        assert.equal(request.authorization, "Bearer synthetic-test-only-key");
        assert.equal(request.body.messages[0].role, "system");
        assert.deepEqual(JSON.parse(request.body.messages[1].content), {
          question: "服务",
        });
        assert.equal(request.body.thinking.type, "disabled");
        assert.equal(request.body.response_format.type, "json_object");
        assert.equal(request.body.tools.length, 6);
        assert.ok(
          !JSON.stringify(request.body).includes("synthetic-test-only-key"),
        );
        assert.ok(
          !request.body.tools.some((x) =>
            /confirm|sql|shell/.test(x.function.name),
          ),
        );
      },
    );
    await check(
      "invalid authentication is sanitized and not retried",
      async () => {
        process.env.AI_RETRIES = "1";
        handler = error(401);
        await fails("MODEL_AUTH");
        assert.equal(requests.length, 1);
      },
    );
    await check(
      "insufficient balance is actionable and not retried",
      async () => {
        handler = error(402);
        await fails("MODEL_BALANCE");
        assert.equal(requests.length, 1);
      },
    );
    await check("rate limit stays bounded", async () => {
      handler = error(429);
      await fails("MODEL_RATE_LIMIT");
      assert.equal(requests.length, 1);
    });
    await check("transient 503 retries once then succeeds", async () => {
      process.env.AI_RETRIES = "1";
      handler = (req, res) =>
        requests.length === 1 ? error(503)(req, res) : ok(req, res);
      assert.equal((await complete("JSON")).data.kind, "reply");
      assert.equal(requests.length, 2);
    });
    await check("429 Retry-After retries once then succeeds", async () => {
      process.env.AI_RETRIES = "1";
      handler = (req, res) => {
        res.setHeader("Retry-After", "0");
        return requests.length === 1 ? error(429)(req, res) : ok(req, res);
      };
      await complete("JSON");
      assert.equal(requests.length, 2);
    });
    await check("persistent 503 performs at most two requests", async () => {
      process.env.AI_RETRIES = "1";
      handler = error(503);
      await fails("MODEL_FAILED");
      assert.equal(requests.length, 2);
    });
    await check("request timeout aborts the network call", async () => {
      process.env.AI_TIMEOUT_MS = "100";
      handler = async (req, res) => {
        await delay(200);
        if (!res.destroyed) ok(req, res);
      };
      await fails("MODEL_TIMEOUT");
    });
    await check("malformed upstream JSON is rejected", async () => {
      handler = (_, res) => res.end("not JSON");
      await fails("MODEL_INVALID_JSON");
    });
    await check("truncated response is not accepted", async () => {
      handler = (_, res) =>
        res.end(
          JSON.stringify(
            completion(reply, {
              choices: [
                {
                  finish_reason: "length",
                  message: { role: "assistant", content: "{}" },
                },
              ],
            }),
          ),
        );
      await fails("MODEL_TRUNCATED");
    });
    await check("invalid reply shape is rejected", async () => {
      handler = (_, res) =>
        res.end(JSON.stringify(completion({ ...reply, citations: [123] })));
      await fails("MODEL_INVALID_JSON");
    });
    await check("oversize response is stopped", async () => {
      handler = (_, res) => {
        res.setHeader("Content-Length", "2000000");
        res.end("{}");
      };
      await fails("MODEL_INVALID_JSON");
    });
    await check(
      "native function call and tool result are replayed correctly",
      async () => {
        const state = {};
        handler = (_, res, body) => {
          if (requests.length === 1)
            res.end(JSON.stringify(toolCompletion([call("list_services")])));
          else {
            assert.equal(body.messages.at(-1).tool_call_id, "call-1");
            assert.equal(body.messages.at(-1).role, "tool");
            res.end(JSON.stringify(completion()));
          }
        };
        const first = await complete("JSON", state);
        assert.equal(first.data.tool, "list_services");
        state.messages.push({
          role: "tool",
          tool_call_id: first.toolCallId,
          content: '{"result":[]}',
        });
        assert.equal((await complete("JSON", state)).data.kind, "reply");
        assert.equal(requests.length, 2);
      },
    );
    await check(
      "batched tools run serially with one result per call id",
      async () => {
        const state = {};
        handler = (_, res, body) =>
          requests.length === 1
            ? res.end(
                JSON.stringify(
                  toolCompletion([
                    call("list_services", {}, "a"),
                    call("get_my_elder_profile", {}, "b"),
                  ]),
                ),
              )
            : res.end(JSON.stringify(completion()));
        const one = await complete("JSON", state);
        state.messages.push({
          role: "tool",
          tool_call_id: one.toolCallId,
          content: "{}",
        });
        const two = await complete("JSON", state);
        assert.equal(two.toolCallId, "b");
        assert.equal(two.usage, null);
        assert.equal(requests.length, 1);
        state.messages.push({
          role: "tool",
          tool_call_id: two.toolCallId,
          content: "{}",
        });
        await complete("JSON", state);
        assert.equal(requests.length, 2);
        assert.deepEqual(
          requests[1].body.messages
            .filter((m) => m.role === "tool")
            .map((m) => m.tool_call_id),
          ["a", "b"],
        );
      },
    );
    await check("unknown SQL tool is blocked", async () => {
      handler = (_, res) =>
        res.end(
          JSON.stringify(
            toolCompletion([call("execute_sql", { sql: "SELECT 1" })]),
          ),
        );
      await fails("MODEL_UNEXPECTED_TOOL");
    });
    await check("identity injection in tool arguments is blocked", async () => {
      handler = (_, res) =>
        res.end(
          JSON.stringify(
            toolCompletion([call("list_my_orders", { userId: 999 })]),
          ),
        );
      await fails("MODEL_UNEXPECTED_TOOL");
    });
    await check(
      "required arguments and integer types are validated",
      async () => {
        handler = (_, res) =>
          res.end(
            JSON.stringify(
              toolCompletion([call("get_order_detail", { orderId: "1" })]),
            ),
          );
        await fails("MODEL_UNEXPECTED_TOOL");
        handler = (_, res) =>
          res.end(
            JSON.stringify(toolCompletion([call("prepare_booking", {})])),
          );
        await fails("MODEL_UNEXPECTED_TOOL");
      },
    );
    await check("tool argument JSON must be an object", async () => {
      const invalid = call("list_services");
      invalid.function.arguments = "[]";
      handler = (_, res) => res.end(JSON.stringify(toolCompletion([invalid])));
      await fails("MODEL_INVALID_JSON");
    });
    await check("redirects never forward the API key", async () => {
      handler = (_, res) => {
        res.statusCode = 302;
        res.setHeader("Location", url + "/other");
        res.end();
      };
      await fails("MODEL_NETWORK");
      assert.equal(requests.length, 1);
    });
    await check("transient connection reset retries once", async () => {
      process.env.AI_RETRIES = "1";
      handler = (req, res) =>
        requests.length === 1 ? req.socket.destroy() : ok(req, res);
      assert.equal((await complete("JSON")).data.kind, "reply");
      assert.equal(requests.length, 2);
    });
    await check("connection errors have no upstream detail", async () => {
      handler = (req) => req.socket.destroy();
      await fails("MODEL_NETWORK");
    });
    await check(
      "concurrency cap is released after requests finish",
      async () => {
        let release;
        const gate = new Promise((resolve) => (release = resolve));
        handler = async (req, res) => {
          await gate;
          ok(req, res);
        };
        const one = complete("JSON"),
          two = complete("JSON");
        try {
          await fails("MODEL_BUSY");
        } finally {
          release();
        }
        await Promise.all([one, two]);
        handler = ok;
        await complete("JSON");
      },
    );
    await check(
      "databases outside the allowed namespace are refused even when AI is disabled",
      async () => {
        for (const name of [
          "linan_elderly_care",
          "linan_ai_upgrade",
          "linan_ai_test",
          "mysql",
          "linan_ai_api;DROP",
        ])
          assert.throws(
            () => databaseName({ DB_NAME: name, AI_ENABLED: "0" }),
            /禁止/,
          );
        assert.equal(
          databaseName({ DB_NAME: "linan_ai_test_api_live" }),
          "linan_ai_test_api_live",
        );
      },
    );
    console.log(
      "HTTP adapter checks passed: " +
        passed +
        "; all requests used local synthetic fixtures.",
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(original, key)) delete process.env[key];
    Object.assign(process.env, original);
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
