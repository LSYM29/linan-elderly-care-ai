"use strict";
const crypto = require("node:crypto");
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
const aliases = [
  ["预约", "预订", "下单"],
  ["取消", "退订"],
  ["费用", "收费", "多少钱", "价格"],
  ["护理", "照护"],
  ["评价", "评分"],
  ["助餐", "吃饭", "送餐"],
];
function normalized(text) {
  let s = String(text).toLowerCase().normalize("NFKC");
  for (const group of aliases)
    for (const word of group.slice(1)) s = s.replaceAll(word, group[0]);
  return s;
}
function tokens(text) {
  const s = normalized(text);
  const words = [...segmenter.segment(s)]
    .filter((x) => x.isWordLike)
    .map((x) => x.segment);
  const chinese = s.match(/[\p{Script=Han}]+/gu) || [];
  for (const word of chinese)
    for (let i = 0; i < word.length - 1; i++) words.push(word.slice(i, i + 2));
  return words;
}
function chunks(text) {
  const pieces = [];
  let section = "正文",
    buffer = "";
  const flush = () => {
    if (buffer.trim()) pieces.push({ section, content: buffer.trim() });
    buffer = "";
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (/^#{1,6}\s+/.test(line)) {
      flush();
      section = line.replace(/^#+\s+/, "").slice(0, 200);
      continue;
    }
    if (buffer.length + line.length > 650) flush();
    if (line.length > 650) {
      flush();
      for (let i = 0; i < line.length; i += 550)
        pieces.push({ section, content: line.slice(i, i + 650) });
    } else buffer += line + "\n";
  }
  flush();
  return pieces;
}
function rank(query, corpus, limit = 5) {
  const q = [...new Set(tokens(query))];
  if (!q.length) return [];
  const docs = corpus.map((d) => ({
    ...d,
    terms: tokens(d.title + " " + d.content),
  }));
  const avg = docs.reduce((s, d) => s + d.terms.length, 0) / (docs.length || 1);
  const df = new Map(
    q.map((w) => [w, docs.filter((d) => d.terms.includes(w)).length]),
  );
  return docs
    .map((d) => {
      const frequencies = new Map();
      for (const w of d.terms)
        frequencies.set(w, (frequencies.get(w) || 0) + 1);
      let score = 0,
        hits = 0;
      for (const w of q) {
        const tf = frequencies.get(w) || 0;
        if (!tf) continue;
        hits++;
        const idf = Math.log(
          1 + (docs.length - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5),
        );
        score +=
          (idf * tf * 2.2) /
          (tf + 1.2 * (0.25 + (0.75 * d.terms.length) / (avg || 1)));
      }
      const coverage = hits / q.length;
      return {
        ...d,
        terms: undefined,
        score: Number((score * 0.8 + coverage * 0.2).toFixed(4)),
        coverage,
      };
    })
    .filter((d) => d.score > 0.7 && d.coverage >= 0.18)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
function hash(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}
module.exports = { tokens, chunks, rank, hash };
