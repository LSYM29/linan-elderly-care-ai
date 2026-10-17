"use strict";
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");
const { Writable } = require("node:stream");
async function main() {
  const envPath = path.resolve(__dirname, "../.env");
  if (!fs.existsSync(envPath))
    throw new Error("请先运行启动系统.bat，创建本地配置。");
  process.stdout.write(
    "请输入 DeepSeek API Key，按回车保存到本地配置（输入不显示）：",
  );
  const silent = new Writable({
    write(chunk, encoding, done) {
      done();
    },
  });
  const rl = readline.createInterface({
    input: process.stdin,
    output: silent,
    terminal: !!process.stdin.isTTY,
  });
  let key;
  try {
    key = (await rl.question("")).trim();
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
  if (!key || key.length < 12 || /\s/.test(key))
    throw new Error("密钥为空或格式不正确，未保存。");
  let text = fs.readFileSync(envPath, "utf8");
  const line = "DEEPSEEK_API_KEY=" + JSON.stringify(key);
  text = /^DEEPSEEK_API_KEY=.*$/m.test(text)
    ? text.replace(/^DEEPSEEK_API_KEY=.*$/m, () => line)
    : text.trimEnd() + "\r\n" + line + "\r\n";
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log(
    "密钥已保存到本地 .env。请重新启动系统使配置生效。此步骤没有发起付费调用。",
  );
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
