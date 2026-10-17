"use strict";
require("dotenv").config({ quiet: true });
const path = require("node:path"),
  { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const database = process.env.TEST_DB_NAME || "linan_ai_test_api";
if (!/^linan_ai_test_api(?:_[A-Za-z0-9]+)?$/.test(database))
  throw Error("Tests require an isolated linan_ai_test_api database");
const env = {
  ...process.env,
  DB_NAME: database,
  AI_ENABLED: "1",
  DEEPSEEK_API_KEY: "",
  TZ: "Asia/Shanghai",
};
function command(file, extra = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [file], {
      cwd: root,
      env: { ...env, ...extra },
      windowsHide: true,
      stdio: "inherit",
    });
    c.on("error", reject);
    c.on("close", (code) =>
      code ? reject(Error(file + " failed " + code)) : resolve(),
    );
  });
}
(async () => {
  let server;
  try {
    await command("scripts/check.js");
    await command("tests/model-http.js");
    await command("scripts/init-db.js");
    await command("scripts/init-ai.js");
    server = spawn(
      process.execPath,
      [
        "-e",
        "const app=require('./server');const s=app.listen(0,'127.0.0.1',()=>console.log('TEST_PORT='+s.address().port));",
      ],
      { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const port = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(() => reject(Error("Server timeout")), 15000);
      server.stdout.on("data", (d) => {
        output += d;
        const m = output.match(/TEST_PORT=(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      server.on("error", reject);
      server.on("exit", () => reject(Error("Server stopped")));
      server.stderr.on("data", (d) => process.stderr.write(d));
    });
    const extra = { BASE_URL: "http://127.0.0.1:" + port };
    await command("tests/api-smoke.js", extra);
    await command("tests/ai-integration.js", extra);
    await command("tests/api-model-e2e.js");
    process.env.TEST_DB_NAME = database;
    await require("./import-evaluation").main();
    console.log(
      "All regression and AI integration checks passed. Database: " + database,
    );
  } finally {
    if (server) server.kill();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
