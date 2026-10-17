"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const mysql = require("mysql2/promise");
const local = require("dotenv").parse(
  fs.readFileSync(path.resolve(__dirname, "../.env")),
);
async function main() {
  const target = local.DB_NAME;
  if (!/^linan_ai_api(?:_[A-Za-z0-9]+)?$/.test(target)) return;
  const source = process.env.TEST_DB_NAME || "linan_ai_test_api";
  if (!/^linan_ai_test_api(?:_[A-Za-z0-9]+)?$/.test(source))
    throw Error("评测来源必须是 API 版独立测试库");
  const c = await mysql.createConnection({
    host: local.DB_HOST || "127.0.0.1",
    port: Number(local.DB_PORT || 3306),
    user: local.DB_USER,
    password: local.DB_PASSWORD,
    database: target,
  });
  try {
    const [rows] = await c.query(
      `SELECT r.*,c.case_key,c.category,c.question,c.expected_json FROM ${source}.ai_eval_results r JOIN ${source}.ai_eval_cases c ON c.id=r.case_id ORDER BY r.id`,
    );
    let copied = 0;
    for (const row of rows) {
      await c.execute(
        "INSERT INTO ai_eval_cases(case_key,category,question,expected_json) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE question=VALUES(question),expected_json=VALUES(expected_json)",
        [
          row.case_key,
          row.category,
          row.question,
          JSON.stringify(
            typeof row.expected_json === "string"
              ? JSON.parse(row.expected_json)
              : row.expected_json,
          ),
        ],
      );
      const [[item]] = await c.execute(
        "SELECT id FROM ai_eval_cases WHERE case_key=?",
        [row.case_key],
      );
      const [[exists]] = await c.execute(
        "SELECT COUNT(*) n FROM ai_eval_results WHERE evaluation_id=? AND case_id=?",
        [row.evaluation_id, item.id],
      );
      if (exists.n) continue;
      const actual =
        typeof row.actual_json === "string"
          ? JSON.parse(row.actual_json)
          : row.actual_json;
      await c.execute(
        "INSERT INTO ai_eval_results(evaluation_id,case_id,run_id,model,passed,actual_json,elapsed_ms) VALUES(?,?,NULL,?,?,?,?)",
        [
          row.evaluation_id,
          item.id,
          row.model,
          row.passed,
          JSON.stringify({
            ...actual,
            sourceDatabase: source,
            sourceRunId: row.run_id || null,
            syntheticData: true,
          }),
          row.elapsed_ms,
        ],
      );
      copied++;
    }
    console.log("Synthetic evaluation results imported: " + copied);
  } finally {
    await c.end();
  }
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
