"use strict";
// 数据库名称校验独立于 AI 开关，防止连接到允许范围之外的数据库。
function databaseName(env = process.env) {
  const name = env.DB_NAME || "linan_ai_api";
  if (
    !/^(?:linan_ai_api(?:_[A-Za-z0-9]+)?|linan_ai_test_api(?:_[A-Za-z0-9]+)?)$/.test(
      name,
    )
  )
    throw new Error(
      "API 版只允许独立的 linan_ai_api 或 linan_ai_test_api 数据库，禁止连接其他数据库",
    );
  return name;
}
module.exports = { databaseName };
