"use strict";
require("dotenv").config({ quiet: true });
process.env.TZ = "Asia/Shanghai";
const assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const pool = require("../db");
const { createKnowledge } = require("../src/ai/knowledge");
const { createBusiness } = require("../src/ai/business");
const { createAssistant } = require("../src/ai/assistant");
const { chunks } = require("../src/ai/retrieval");
if (!/^linan_ai_test_api(?:_[A-Za-z0-9]+)?$/.test(process.env.DB_NAME || ""))
  throw Error("AI tests require isolated test database");
const BASE = process.env.BASE_URL,
  evaluationId = crypto.randomUUID(),
  marker = Date.now().toString(36);
let passed = 0;
class Client {
  constructor() {
    this.cookie = "";
  }
  async call(method, url, body) {
    const r = await fetch(BASE + url, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie"))
      this.cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
  async login(username, password) {
    const r = await this.call("POST", "/api/login", { username, password });
    assert.equal(r.status, 200);
    this.user = r.body.user;
  }
}
const admin = new Client(),
  family = new Client(),
  other = new Client(),
  caregiver = new Client(),
  guest = new Client();
const reject = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const transaction = async (fn) => {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
};
const cleanText = (v, label, o = {}) => {
  if (
    typeof v !== "string" ||
    (o.required && !v.trim()) ||
    v.length > (o.max || Infinity)
  )
    reject(400, label);
  return v.trim();
};
const parseId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) reject(400, "id");
  return n;
};
const deps = { pool, transaction, reject, cleanText, parseId };
const knowledge = createKnowledge(deps),
  business = createBusiness(deps);
async function record(key, category, expected, actual, ok, ms) {
  await pool.execute(
    "INSERT INTO ai_eval_cases(case_key,category,question,expected_json) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE expected_json=VALUES(expected_json)",
    [key, category, key, JSON.stringify(expected)],
  );
  const [[c]] = await pool.execute(
    "SELECT id FROM ai_eval_cases WHERE case_key=?",
    [key],
  );
  await pool.execute(
    "INSERT INTO ai_eval_results(evaluation_id,case_id,model,passed,actual_json,elapsed_ms) VALUES(?,?,?,?,?,?)",
    [
      evaluationId,
      c.id,
      "程序回归",
      ok ? 1 : 0,
      JSON.stringify(actual || {}),
      ms,
    ],
  );
}
async function test(key, category, fn) {
  const start = Date.now();
  try {
    await fn();
    passed++;
    await record(
      key,
      category,
      { assertions: "all passed" },
      { result: "passed" },
      true,
      Date.now() - start,
    );
    console.log("PASS " + key);
  } catch (e) {
    await record(
      key,
      category,
      { assertions: "all passed" },
      { error: e.message },
      false,
      Date.now() - start,
    );
    throw e;
  }
}
const expect = async (p, status) => {
  const r = await p;
  assert.equal(r.status, status, JSON.stringify(r.body));
  return r.body;
};
let serviceId, draft, documentId, orderId;
const future = new Date(Date.now() + 3 * 86400000).toLocaleString("sv-SE", {
  timeZone: "Asia/Shanghai",
});
const input = () => ({
  serviceId,
  appointmentTime: future,
  serviceAddress: "集成测试社区8号301室",
  remark: "自动化测试",
});
async function makeDraft() {
  return expect(family.call("POST", "/api/ai/drafts", input()), 200);
}
function fake(actions) {
  let i = 0;
  return async () => ({
    data: actions[Math.min(i++, actions.length - 1)],
    usage: { input_tokens: 10, output_tokens: 10 },
    model: "mock-structured-output",
  });
}
const reply = (answer, citations = []) => ({
  kind: "reply",
  answer,
  tool: "",
  arguments: "{}",
  citations,
});
const tool = (name, args) => ({
  kind: "tool",
  answer: "",
  tool: name,
  arguments: JSON.stringify(args),
  citations: [],
});
function samplePdf(text = "Elderly care demo booking guide") {
  const content = text ? `BT /F1 12 Tf 50 750 Td (${text}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let data = "%PDF-1.4\n";
  const positions = [0];
  objects.forEach((o, i) => {
    positions.push(Buffer.byteLength(data));
    data += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = Buffer.byteLength(data);
  data +=
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    positions
      .slice(1)
      .map((p) => String(p).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(data).toString("base64");
}
(async () => {
  try {
    await admin.login("admin", "admin123");
    await family.login("family", "family123");
    await caregiver.login("caregiver", "caregiver123");
    const account = "ai_" + marker;
    await expect(
      admin.call("POST", "/api/users", {
        username: account,
        password: "synthetic-api-test-password",
        realName: "隔离测试家属",
        role: "family",
      }),
      201,
    );
    await other.login(account, "synthetic-api-test-password");
    const service = await expect(
      admin.call("POST", "/api/services", {
        name: "AI测试项目_" + marker,
        category: "测试",
        description: "测试专用",
        price: 12.34,
        durationMinutes: 30,
      }),
      201,
    );
    serviceId = service.id;
    await test("guest-cannot-chat", "权限", () =>
      expect(guest.call("POST", "/api/ai/chat", { message: "你好" }), 401),
    );
    await test("family-cannot-manage-documents", "权限", () =>
      expect(family.call("GET", "/api/ai/documents"), 403),
    );
    await test("caregiver-cannot-book", "权限", () =>
      expect(caregiver.call("POST", "/api/ai/drafts", input()), 403),
    );
    await test("family-cannot-read-runs", "权限", () =>
      expect(family.call("GET", "/api/ai/runs"), 403),
    );
    await test("family-cannot-extract-pdf", "权限", () =>
      expect(
        family.call("POST", "/api/ai/documents/extract", {
          base64: samplePdf(),
        }),
        403,
      ),
    );
    await test("invalid-pdf-rejected", "知识库", () =>
      expect(
        admin.call("POST", "/api/ai/documents/extract", {
          base64: Buffer.from("invalid").toString("base64"),
        }),
        400,
      ),
    );
    await test("pdf-extracts-text-and-page", "知识库", async () => {
      const result = await expect(
        admin.call("POST", "/api/ai/documents/extract", {
          base64: samplePdf(),
        }),
        200,
      );
      assert.equal(result.pages, 1);
      assert.ok(result.content.includes("第 1 页"));
      assert.ok(result.content.includes("Elderly care demo"));
    });
    await test("image-only-pdf-needs-ocr", "知识库", async () => {
      const result = await expect(
        admin.call("POST", "/api/ai/documents/extract", {
          base64: samplePdf(""),
        }),
        422,
      );
      assert.ok(result.message.includes("文字识别"));
    });
    await test("document-import-and-chunks", "知识库", async () => {
      const d = await expect(
        admin.call("POST", "/api/ai/documents", {
          title: "黄铜灯演示政策_" + marker,
          region: "甲地区",
          publishedOn: "2026-01-01",
          content:
            "# 办理材料\n黄铜灯示范服务需要纸质登记表和服务证。仅适用于甲地区，这是测试资料。",
        }),
        200,
      );
      documentId = d.id;
      assert.ok(d.chunks > 0);
    });
    await test("region-isolation", "知识库", async () => {
      const a = await knowledge.search("黄铜灯示范服务需要什么材料", "甲地区"),
        b = await knowledge.search("黄铜灯示范服务需要什么材料", "乙地区");
      assert.ok(a.sources.some((s) => s.title.includes(marker)));
      assert.ok(!b.sources.some((s) => s.title.includes(marker)));
    });
    await test("disabled-document-not-retrieved", "知识库", async () => {
      await expect(
        admin.call("PUT", `/api/ai/documents/${documentId}/status`, {
          status: 0,
        }),
        200,
      );
      assert.ok(
        !(await knowledge.corpus("甲地区")).some((s) =>
          s.title.includes(marker),
        ),
      );
      await expect(
        admin.call("PUT", `/api/ai/documents/${documentId}/status`, {
          status: 1,
        }),
        200,
      );
    });
    await test("document-version-update", "知识库", async () => {
      await expect(
        admin.call("PUT", `/api/ai/documents/${documentId}`, {
          title: "黄铜灯演示政策_" + marker,
          region: "甲地区",
          content:
            "# 更新材料\n黄铜灯示范服务现需要新的服务登记卡。此为甲地区测试资料。",
        }),
        200,
      );
      const rows = await expect(admin.call("GET", "/api/ai/documents"), 200);
      assert.equal(rows.find((d) => d.id === documentId).version, 2);
    });
    await test("expired-document-not-retrieved", "知识库", async () => {
      await pool.execute("UPDATE ai_documents SET expires_on=? WHERE id=?", [
        "2000-01-01",
        documentId,
      ]);
      assert.ok(
        !(await knowledge.corpus("甲地区")).some((s) =>
          s.title.includes(marker),
        ),
      );
      await pool.execute("UPDATE ai_documents SET expires_on=NULL WHERE id=?", [
        documentId,
      ]);
    });
    await test("future-document-not-retrieved", "知识库", async () => {
      await pool.execute("UPDATE ai_documents SET published_on=? WHERE id=?", [
        "2099-01-01",
        documentId,
      ]);
      assert.ok(
        !(await knowledge.corpus("甲地区")).some((s) =>
          s.title.includes(marker),
        ),
      );
      await pool.execute(
        "UPDATE ai_documents SET published_on=NULL WHERE id=?",
        [documentId],
      );
    });
    await test("invalid-calendar-date", "输入", () =>
      expect(
        admin.call("PUT", `/api/ai/documents/${documentId}`, {
          title: "测试",
          content: "这是一段测试正文，至少十个字。",
          publishedOn: "2026-02-30",
        }),
        400,
      ),
    );
    await test("empty-document-rejected", "输入", () =>
      expect(
        admin.call("POST", "/api/ai/documents", { title: "空白", content: "" }),
        400,
      ),
    );
    await test("chunking-keeps-sections", "知识库", async () => {
      const parts = chunks(
        "# 第一章\n" + "服务说明".repeat(300) + "\n# 第二章\n需要预约",
      );
      assert.ok(parts.length > 2);
      assert.equal(parts.at(-1).section, "第二章");
      assert.ok(parts.every((p) => p.content.length <= 650));
    });
    await test("unknown-question-no-false-match", "知识库", async () => {
      assert.equal(
        (await knowledge.search("量子色动力学夸克禁闭实验XYZ")).sources.length,
        0,
      );
    });
    await test("draft-creates-no-order", "预约", async () => {
      const [[before]] = await pool.execute(
        "SELECT COUNT(*) n FROM service_orders",
      );
      draft = await makeDraft();
      const [[after]] = await pool.execute(
        "SELECT COUNT(*) n FROM service_orders",
      );
      assert.equal(before.n, after.n);
      assert.equal(draft.status, "pending");
    });
    await test("draft-owner-isolation", "权限", () =>
      expect(other.call("GET", "/api/ai/drafts/" + draft.id), 404),
    );
    await test("draft-confirm-owner-isolation", "权限", () =>
      expect(
        other.call("POST", `/api/ai/drafts/${draft.id}/confirm`, {
          confirm: true,
          revision: draft.revision,
        }),
        404,
      ),
    );
    await test("explicit-confirm-required", "预约", () =>
      expect(
        family.call("POST", `/api/ai/drafts/${draft.id}/confirm`, {
          revision: draft.revision,
        }),
        400,
      ),
    );
    await test("stale-revision-rejected", "预约", () =>
      expect(
        family.call("POST", `/api/ai/drafts/${draft.id}/confirm`, {
          confirm: true,
          revision: 999,
        }),
        409,
      ),
    );
    await test("parallel-confirm-idempotent", "预约", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          family.call("POST", `/api/ai/drafts/${draft.id}/confirm`, {
            confirm: true,
            revision: draft.revision,
          }),
        ),
      );
      results.forEach((r) => assert.equal(r.status, 200));
      assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
      orderId = results[0].body.id;
      const [[count]] = await pool.execute(
        "SELECT COUNT(*) n FROM service_orders WHERE id=?",
        [orderId],
      );
      assert.equal(count.n, 1);
      const [[logs]] = await pool.execute(
        "SELECT COUNT(*) n FROM order_status_logs WHERE order_id=?",
        [orderId],
      );
      assert.equal(logs.n, 1);
    });
    await test("order-price-and-identity-from-server", "预约", async () => {
      const [[order]] = await pool.execute(
        "SELECT * FROM service_orders WHERE id=?",
        [orderId],
      );
      assert.equal(order.elder_id, family.user.id);
      assert.equal(Number(order.service_price_snapshot), 12.34);
      const [[log]] = await pool.execute(
        "SELECT action_note FROM order_status_logs WHERE order_id=?",
        [orderId],
      );
      assert.ok(log.action_note.includes("智能助手"));
    });
    await test("price-change-requires-reconfirmation", "预约", async () => {
      const d = await makeDraft();
      await pool.execute("UPDATE service_items SET price=13.45 WHERE id=?", [
        serviceId,
      ]);
      await expect(
        family.call("POST", `/api/ai/drafts/${d.id}/confirm`, {
          confirm: true,
          revision: d.revision,
        }),
        409,
      );
      const updated = await expect(
        family.call("PUT", `/api/ai/drafts/${d.id}`, {
          ...input(),
          revision: d.revision,
        }),
        200,
      );
      assert.equal(Number(updated.service.price), 13.45);
      await expect(
        family.call("POST", `/api/ai/drafts/${d.id}/confirm`, {
          confirm: true,
          revision: d.revision,
        }),
        409,
      );
      await expect(
        family.call("POST", `/api/ai/drafts/${d.id}/confirm`, {
          confirm: true,
          revision: updated.revision,
        }),
        200,
      );
    });
    await test("expired-draft-blocked", "预约", async () => {
      const d = await makeDraft();
      await pool.execute(
        "UPDATE ai_action_drafts SET expires_at=DATE_SUB(NOW(),INTERVAL 1 MINUTE) WHERE id=?",
        [d.id],
      );
      await expect(
        family.call("POST", `/api/ai/drafts/${d.id}/confirm`, {
          confirm: true,
          revision: d.revision,
        }),
        409,
      );
    });
    await test("disabled-service-blocked", "预约", async () => {
      const d = await makeDraft();
      await pool.execute("UPDATE service_items SET status=0 WHERE id=?", [
        serviceId,
      ]);
      await expect(
        family.call("POST", `/api/ai/drafts/${d.id}/confirm`, {
          confirm: true,
          revision: d.revision,
        }),
        400,
      );
      await pool.execute("UPDATE service_items SET status=1 WHERE id=?", [
        serviceId,
      ]);
    });
    await test("cancelled-draft-blocked", "预约", async () => {
      const d = await makeDraft();
      await expect(
        family.call("POST", `/api/ai/drafts/${d.id}/cancel`, {}),
        200,
      );
      await expect(
        family.call("POST", `/api/ai/drafts/${d.id}/confirm`, {
          confirm: true,
          revision: d.revision,
        }),
        409,
      );
    });
    await test("order-log-failure-rolls-back", "预约", async () => {
      const d = await makeDraft();
      const [[before]] = await pool.execute(
        "SELECT COUNT(*) n FROM service_orders",
      );
      try {
        await pool.query(
          "CREATE TRIGGER ai_test_fail_log BEFORE INSERT ON order_status_logs FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic rollback test'",
        );
        await expect(
          family.call("POST", `/api/ai/drafts/${d.id}/confirm`, {
            confirm: true,
            revision: d.revision,
          }),
          500,
        );
        const [[after]] = await pool.execute(
          "SELECT COUNT(*) n FROM service_orders",
        );
        assert.equal(before.n, after.n);
        const [[saved]] = await pool.execute(
          "SELECT status,order_id FROM ai_action_drafts WHERE id=?",
          [d.id],
        );
        assert.equal(saved.status, "pending");
        assert.equal(saved.order_id, null);
      } finally {
        await pool.query("DROP TRIGGER IF EXISTS ai_test_fail_log");
      }
    });
    await test("past-appointment-rejected", "输入", () =>
      expect(
        family.call("POST", "/api/ai/drafts", {
          ...input(),
          appointmentTime: "2020-01-01 10:00:00",
        }),
        400,
      ),
    );
    await test("ambiguous-time-rejected", "输入", () =>
      expect(
        family.call("POST", "/api/ai/drafts", {
          ...input(),
          appointmentTime: "明天下午",
        }),
        400,
      ),
    );
    await test("missing-address-rejected", "输入", () =>
      expect(
        family.call("POST", "/api/ai/drafts", {
          ...input(),
          serviceAddress: "",
        }),
        400,
      ),
    );
    await test("other-family-order-invisible", "权限", async () => {
      await assert.rejects(
        () => business.detail(other.user, { orderId }),
        (e) => e.status === 404,
      );
      assert.ok(
        !(await business.orders(other.user)).some((o) => o.id === orderId),
      );
    });
    await test("caregiver-unassigned-order-invisible", "权限", () =>
      assert.rejects(
        () => business.detail(caregiver.user, { orderId }),
        (e) => e.status === 404,
      ),
    );
    await test("forged-user-tool-parameter-blocked", "权限", () =>
      assert.rejects(
        () =>
          business.execute(family.user, "list_my_orders", {
            userId: other.user.id,
          }),
        (e) => e.status === 400,
      ),
    );
    await test("unknown-tool-blocked", "权限", () =>
      assert.rejects(
        () =>
          business.execute(family.user, "execute_sql", {
            sql: "SELECT * FROM users",
          }),
        (e) => e.status === 400,
      ),
    );
    await test("citation-ids-validated", "模型协议", async () => {
      const assistant = createAssistant({
        ...deps,
        knowledge,
        business,
        model: fake([reply("编造回答", ["D9999999"])]),
      });
      await assert.rejects(
        () => assistant.chat(family.user, { message: "服务怎么预约" }),
        (e) => e.status === 422,
      );
    });
    await test("no-evidence-refuses", "模型协议", async () => {
      const assistant = createAssistant({
        ...deps,
        knowledge,
        business,
        model: fake([reply("编造高额补贴")]),
      });
      const answer = await assistant.chat(family.user, {
        message: "量子色动力学XYZ补贴标准",
      });
      assert.ok(answer.answer.includes("资料不足"));
      assert.equal(answer.sources.length, 0);
    });
    await test("controlled-tool-loop", "模型协议", async () => {
      const assistant = createAssistant({
        ...deps,
        knowledge,
        business,
        model: fake([
          tool("list_my_orders", {}),
          reply("已根据授权订单查询结果列出。"),
        ]),
      });
      const result = await assistant.chat(family.user, {
        message: "我的预约有哪些",
      });
      assert.ok(result.orders.some((o) => o.id === orderId));
      const [[run]] = await pool.execute(
        "SELECT trace,status FROM ai_runs WHERE id=?",
        [result.runId],
      );
      assert.equal(run.status, "completed");
      assert.ok(JSON.stringify(run.trace).includes("list_my_orders"));
    });
    await test("session-owner-isolation", "权限", async () => {
      const rows = await expect(family.call("GET", "/api/ai/sessions"), 200);
      assert.ok(rows.length);
      await expect(other.call("GET", "/api/ai/sessions/" + rows[0].id), 404);
    });
    await test("tool-round-limit", "模型协议", async () => {
      const assistant = createAssistant({
        ...deps,
        knowledge,
        business,
        model: fake([tool("list_services", {})]),
      });
      await assert.rejects(
        () => assistant.chat(family.user, { message: "有哪些服务" }),
        (e) => e.status === 422,
      );
    });
    await test("model-error-persisted", "模型协议", async () => {
      const assistant = createAssistant({
        ...deps,
        knowledge,
        business,
        model: async () => {
          throw Object.assign(new Error("模拟超时"), {
            status: 503,
            code: "MODEL_TIMEOUT",
          });
        },
      });
      await assert.rejects(
        () => assistant.chat(family.user, { message: "模型超时测试" }),
        (e) => e.code === "MODEL_TIMEOUT",
      );
      const [[row]] = await pool.execute(
        "SELECT status,error_code FROM ai_runs WHERE question='模型超时测试' ORDER BY created_at DESC LIMIT 1",
      );
      assert.equal(row.status, "failed");
      assert.equal(row.error_code, "MODEL_TIMEOUT");
    });
    await test("cross-origin-write-blocked", "权限", async () => {
      const r = await fetch(BASE + "/api/ai/drafts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: family.cookie,
          Origin: "https://unrelated.invalid",
        },
        body: JSON.stringify(input()),
      });
      assert.equal(r.status, 403);
    });
    await test("evaluation-visible-to-admin", "评测", async () => {
      assert.ok(
        (await expect(admin.call("GET", "/api/ai/evaluations"), 200)).length >
          0,
      );
      assert.ok(
        (await expect(admin.call("GET", "/api/ai/evaluation-summary"), 200))
          .length > 0,
      );
    });
    console.log(
      `AI integration checks passed: ${passed}; evaluation ${evaluationId}`,
    );
  } finally {
    await pool.end();
  }
})().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
