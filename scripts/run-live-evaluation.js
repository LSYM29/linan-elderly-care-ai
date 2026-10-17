"use strict";
require("dotenv").config({ quiet: true });
const path = require("node:path"),
  { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const database = process.env.TEST_DB_NAME || "linan_ai_test_api_live";
if (!/^linan_ai_test_api(?:_[A-Za-z0-9]+)?$/.test(database))
  throw Error("Real evaluation requires isolated API test database");
const env = {
  ...process.env,
  DB_NAME: database,
  AI_ENABLED: "1",
  TZ: "Asia/Shanghai",
};
async function run(file, extra = {}) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, [file], {
      cwd: root,
      env: { ...env, ...extra },
      windowsHide: true,
      stdio: "inherit",
    });
    c.on("error", reject);
    c.on("exit", (code) =>
      code ? reject(Error(file + " failed " + code)) : resolve(),
    );
  });
}
(async () => {
  let server;
  try {
    require("../src/ai/model").config();
    await run("scripts/init-db.js");
    await run("scripts/init-ai.js");
    server = spawn(
      process.execPath,
      [
        "-e",
        "const app=require('./server');app.listen(0,'127.0.0.1',function(){console.log('EVAL_PORT='+this.address().port)});",
      ],
      { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const port = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(Error("Evaluation server timeout")),
        15000,
      );
      server.stdout.on("data", (d) => {
        output += d;
        const m = output.match(/EVAL_PORT=(\d+)/);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      server.stderr.on("data", (d) => process.stderr.write(d));
      server.on("error", reject);
    });
    await run("scripts/evaluate-live.js", {
      BASE_URL: "http://127.0.0.1:" + port,
    });
    process.env.TEST_DB_NAME = database;
    await require("./import-evaluation").main();
  } finally {
    if (server) server.kill();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
