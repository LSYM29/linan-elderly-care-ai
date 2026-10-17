"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
let active = false;
async function extract(base64, reject) {
  if (
    typeof base64 !== "string" ||
    base64.length > 7 * 1024 * 1024 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    reject(400, "PDF 文件格式不正确或超过 5 MB");
  const bytes = Buffer.from(base64, "base64");
  if (
    bytes.length > 5 * 1024 * 1024 ||
    bytes.subarray(0, 5).toString() !== "%PDF-"
  )
    reject(400, "请选择不超过 5 MB 的有效 PDF");
  if (active) reject(429, "正在解析另一份 PDF，请稍后重试");
  active = true;
  try {
    return await new Promise((resolve, fail) => {
      const child = spawn(
        process.execPath,
        [path.join(__dirname, "pdf-worker.js")],
        {
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
          env: {
            ...process.env,
            DB_PASSWORD: "",
            SESSION_SECRET: "",
            OPENAI_API_KEY: "",
            DEEPSEEK_API_KEY: "",
          },
        },
      );
      let output = "",
        timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 20000);
      child.stdout.on("data", (d) => {
        output += d;
        if (output.length > 1000000) child.kill();
      });
      child.stderr.on("data", () => {});
      child.on("error", fail);
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ base64 }));
      child.on("close", (code) => {
        clearTimeout(timer);
        let result;
        try {
          result = JSON.parse(output.slice(output.indexOf("{")));
        } catch {
          result = { error: "PDF_INVALID" };
        }
        if (code !== 0 || result.error || timedOut) {
          const errors = {
            PDF_RUNTIME_MISSING:
              "未配置 PDF 解析库，请配置 AI_PDFJS_PATH 或安装 pdfjs-dist",
            PDF_NEEDS_OCR:
              "未提取到正文，这可能是扫描图片型 PDF；请先文字识别，再导入 TXT 或 Markdown",
            PDF_TOO_LONG: "PDF 正文超过 60000 字，请拆分文件",
            PDF_TOO_MANY_PAGES: "PDF 超过 100 页，请拆分文件",
          };
          const e = new Error(
            timedOut
              ? "PDF 解析超时，请拆分后重试"
              : errors[result.error] ||
                "PDF 无法解析，请检查文件是否损坏或加密",
          );
          e.status = 422;
          fail(e);
        } else resolve(result);
      });
    });
  } finally {
    active = false;
  }
}
module.exports = { extract };
