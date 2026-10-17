"use strict";
const { pathToFileURL } = require("node:url");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", async () => {
  let task;
  try {
    const payload = JSON.parse(input);
    const library =
      process.env.AI_PDFJS_PATH ||
      require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    const pdfjs = await import(pathToFileURL(library).href);
    task = pdfjs.getDocument({
      data: new Uint8Array(Buffer.from(payload.base64, "base64")),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    });
    const pdf = await task.promise;
    if (pdf.numPages > 100) throw Error("PDF_TOO_MANY_PAGES");
    const parts = [];
    let count = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const text = await page.getTextContent();
      const content = text.items
        .map((item) => item.str + (item.hasEOL ? "\n" : " "))
        .join("")
        .trim();
      if (content) {
        count += content.length;
        if (count > 60000) throw Error("PDF_TOO_LONG");
        parts.push("# 第 " + i + " 页\n" + content);
      }
      page.cleanup();
    }
    if (count < 10) throw Error("PDF_NEEDS_OCR");
    process.stdout.write(
      JSON.stringify({ content: parts.join("\n\n"), pages: pdf.numPages }),
    );
  } catch (e) {
    process.stdout.write(
      JSON.stringify({
        error:
          e.code === "MODULE_NOT_FOUND"
            ? "PDF_RUNTIME_MISSING"
            : e.message?.startsWith("PDF_")
              ? e.message
              : "PDF_INVALID",
      }),
    );
    process.exitCode = 1;
  } finally {
    if (task) await task.destroy().catch(() => {});
  }
});
