"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const readline = require("node:readline/promises");
const dotenv = require("dotenv");
const root = path.resolve(__dirname, "..");
const envFile = path.join(root, ".env");
const { databaseName } = require("../src/database-config");
async function main() {
  const current = fs.existsSync(envFile)
    ? dotenv.parse(fs.readFileSync(envFile))
    : {};
  if (current.DB_NAME) databaseName(current);
  const missing =
    !Object.hasOwn(current, "DB_PASSWORD") ||
    /请填写|your_mysql|change_me/i.test(current.DB_PASSWORD);
  let password = current.DB_PASSWORD;
  if (missing) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      password = await rl.question(
        "请输入本机 MySQL 密码（仅保存到本目录 .env）：",
      );
    } finally {
      rl.close();
    }
  }
  const config = {
    PORT: current.PORT || "3002",
    DB_HOST: current.DB_HOST || "127.0.0.1",
    DB_PORT: current.DB_PORT || "3306",
    DB_USER: current.DB_USER || "root",
    DB_PASSWORD: password || "",
    DB_NAME: current.DB_NAME || "linan_ai_api",
    SESSION_SECRET:
      current.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    AI_ENABLED: current.AI_ENABLED || "1",
    AI_PROVIDER: "deepseek",
    AI_BASE_URL: current.AI_BASE_URL || "https://api.deepseek.com/v1",
    AI_MODEL: current.AI_MODEL || "deepseek-flash",
    DEEPSEEK_API_KEY: current.DEEPSEEK_API_KEY || "",
    AI_TIMEOUT_MS: current.AI_TIMEOUT_MS || "45000",
    AI_MAX_TOKENS: current.AI_MAX_TOKENS || "2048",
    AI_RETRIES: current.AI_RETRIES ?? "1",
  };
  const text =
    Object.entries(config)
      .map(
        ([key, value]) =>
          key + "=" + (value ? JSON.stringify(String(value)) : ""),
      )
      .join("\r\n") + "\r\n";
  const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
  if (before !== text) fs.writeFileSync(envFile, text, { mode: 0o600 });
  console.log("[配置] 独立 API 版配置就绪，数据库：" + config.DB_NAME);
  if (!config.DEEPSEEK_API_KEY)
    console.log(
      "[提示] API 密钥尚未填写，普通业务可使用；AI 调用会提示配置。可双击 配置API密钥.bat。",
    );
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
