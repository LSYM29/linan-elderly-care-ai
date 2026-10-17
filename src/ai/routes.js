"use strict";
const { createKnowledge } = require("./knowledge");
const { createBusiness } = require("./business");
const { createAssistant } = require("./assistant");
function mountAi(app, deps) {
  const {
    pool,
    requireLogin,
    allowRoles,
    asyncRoute,
    parseId,
    reject,
    cleanText,
  } = deps;
  const knowledge = createKnowledge(deps),
    business = createBusiness(deps),
    assistant = createAssistant({ ...deps, knowledge, business });
  const wrap = (fn) =>
    asyncRoute(async (req, res) => res.json(await fn(req, res)));
  // Browser writes must come from this origin. There are no externally executable model tools.
  app.use("/api/ai", (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      if (origin) {
        let host;
        try {
          host = new URL(origin).host;
        } catch {
          return next(Object.assign(new Error("来源不正确"), { status: 403 }));
        }
        if (host !== req.get("host"))
          return next(
            Object.assign(new Error("请求来源不允许"), { status: 403 }),
          );
      }
    }
    next();
  });
  app.get(
    "/api/ai/status",
    requireLogin,
    wrap(async () => ({
      provider: "DeepSeek API",
      model: process.env.AI_MODEL || "deepseek-flash",
      configured: require("./model").isConfigured(),
      retrieval: "BM25 中文分词及双字词检索",
      enabled: process.env.AI_ENABLED === "1",
    })),
  );
  app.post(
    "/api/ai/chat",
    requireLogin,
    wrap((req) => assistant.chat(req.session.user, req.body)),
  );
  app.get(
    "/api/ai/sessions",
    requireLogin,
    wrap(async (req) => {
      const [rows] = await pool.execute(
        "SELECT id,title,updated_at FROM ai_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 30",
        [req.session.user.id],
      );
      return rows;
    }),
  );
  app.get(
    "/api/ai/sessions/:id",
    requireLogin,
    wrap(async (req) => {
      await assistant.session(req.session.user, req.params.id);
      const [rows] = await pool.execute(
        "SELECT id,role,content,payload,created_at FROM ai_messages WHERE session_id=? ORDER BY id DESC LIMIT 100",
        [req.params.id],
      );
      return rows.reverse();
    }),
  );
  app.get(
    "/api/ai/drafts/:id",
    allowRoles("family"),
    wrap((req) => business.getDraft(req.session.user, req.params.id)),
  );
  app.post(
    "/api/ai/drafts",
    allowRoles("family"),
    wrap((req) => business.prepare(req.session.user, req.body)),
  );
  app.put(
    "/api/ai/drafts/:id",
    allowRoles("family"),
    wrap((req) => business.prepare(req.session.user, req.body, req.params.id)),
  );
  app.post(
    "/api/ai/drafts/:id/confirm",
    allowRoles("family"),
    wrap((req) => business.confirm(req.session.user, req.params.id, req.body)),
  );
  app.post(
    "/api/ai/drafts/:id/cancel",
    allowRoles("family"),
    wrap((req) => business.cancel(req.session.user, req.params.id)),
  );
  app.get(
    "/api/ai/documents",
    allowRoles("admin"),
    wrap(async () => {
      const [rows] = await pool.execute(
        "SELECT d.*, (SELECT COUNT(*) FROM ai_chunks c WHERE c.document_id=d.id) chunk_count FROM ai_documents d ORDER BY updated_at DESC LIMIT 100",
      );
      return rows;
    }),
  );
  app.post(
    "/api/ai/documents",
    allowRoles("admin"),
    wrap((req) => knowledge.save(req.session.user, req.body)),
  );
  app.post(
    "/api/ai/documents/extract",
    allowRoles("admin"),
    wrap((req) => require("./pdf").extract(req.body.base64, reject)),
  );
  app.put(
    "/api/ai/documents/:id",
    allowRoles("admin"),
    wrap((req) =>
      knowledge.save(req.session.user, req.body, parseId(req.params.id)),
    ),
  );
  app.put(
    "/api/ai/documents/:id/status",
    allowRoles("admin"),
    wrap(async (req) => {
      if (![0, 1].includes(req.body.status)) reject(400, "资料状态不正确");
      const [r] = await pool.execute(
        "UPDATE ai_documents SET status=? WHERE id=?",
        [req.body.status, parseId(req.params.id)],
      );
      if (!r.affectedRows) reject(404, "资料不存在");
      return { message: "资料状态已更新" };
    }),
  );
  app.get(
    "/api/ai/knowledge/search",
    requireLogin,
    wrap((req) =>
      knowledge.search(
        cleanText(req.query.query, "检索词", { required: true, max: 2000 }),
        cleanText(req.query.region || "通用", "地区", { max: 80 }),
      ),
    ),
  );
  app.get(
    "/api/ai/runs",
    allowRoles("admin"),
    wrap(async () => {
      const [rows] = await pool.execute(
        "SELECT id,user_id,model,prompt_version,question,elapsed_ms,usage_json,status,error_code,created_at FROM ai_runs ORDER BY created_at DESC LIMIT 50",
      );
      return rows;
    }),
  );
  app.get(
    "/api/ai/runs/:id",
    allowRoles("admin"),
    wrap(async (req) => {
      const [[row]] = await pool.execute("SELECT * FROM ai_runs WHERE id=?", [
        req.params.id,
      ]);
      if (!row) reject(404, "运行记录不存在");
      return row;
    }),
  );
  app.get(
    "/api/ai/evaluations",
    allowRoles("admin"),
    wrap(async () => {
      const [rows] = await pool.execute(
        "SELECT r.*,c.case_key,c.category,c.question,c.expected_json FROM ai_eval_results r JOIN ai_eval_cases c ON c.id=r.case_id ORDER BY r.id DESC LIMIT 100",
      );
      return rows;
    }),
  );
  app.get(
    "/api/ai/evaluation-summary",
    allowRoles("admin"),
    wrap(async () => {
      const [rows] = await pool.execute(
        "SELECT r.model,r.evaluation_id,COUNT(*) total,SUM(r.passed) passed,ROUND(AVG(r.elapsed_ms)) avg_ms FROM ai_eval_results r WHERE r.evaluation_id=(SELECT r2.evaluation_id FROM ai_eval_results r2 WHERE r2.model=r.model ORDER BY r2.id DESC LIMIT 1) GROUP BY r.model,r.evaluation_id",
      );
      return rows;
    }),
  );
  return { knowledge, business, assistant };
}
module.exports = { mountAi };
