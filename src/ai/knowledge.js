"use strict";
const { chunks, rank, hash } = require("./retrieval");
function createKnowledge({ pool, transaction, reject, cleanText }) {
  async function corpus(region = "通用") {
    const [rows] = await pool.execute(
      `SELECT c.id,c.content,c.section_title,d.title,d.region,d.version,d.published_on,d.expires_on
   FROM ai_chunks c JOIN ai_documents d ON d.id=c.document_id
   WHERE d.status=1 AND (d.expires_on IS NULL OR d.expires_on>=CURRENT_DATE()) AND (d.published_on IS NULL OR d.published_on<=CURRENT_DATE())
   AND (d.region='通用' OR d.region=?) ORDER BY c.id LIMIT 5000`,
      [region],
    );
    const [faqs] = await pool.execute(
      "SELECT id,question,answer,category,updated_at FROM ai_faqs WHERE status=1 ORDER BY sort_order,id LIMIT 500",
    );
    return [
      ...rows.map((r) => ({
        id: "D" + r.id,
        title: r.title,
        section: r.section_title,
        content: r.content,
        region: r.region,
        version: r.version,
        publishedOn: r.published_on,
        expiresOn: r.expires_on,
      })),
      ...faqs.map((r) => ({
        id: "F" + r.id,
        title: "系统常见问题（演示资料）",
        section: r.question,
        content: r.question + "\n" + r.answer,
        region: "通用",
        version: String(r.updated_at),
      })),
    ];
  }
  async function search(query, region) {
    const docs = await corpus(region);
    return { sources: rank(query, docs), knowledgeVersion: hash(docs) };
  }
  async function save(user, input, id) {
    const title = cleanText(input.title, "资料标题", {
      required: true,
      max: 150,
    });
    const content = cleanText(input.content, "资料正文", {
      required: true,
      min: 10,
      max: 60000,
    });
    const region = cleanText(input.region || "通用", "适用地区", {
      required: true,
      max: 80,
    });
    const date = (value) => {
      if (!value) return null;
      if (
        typeof value !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value + "T00:00:00+08:00")) ||
        new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
      )
        reject(400, "资料日期格式错误");
      return value;
    };
    const published = date(input.publishedOn),
      expires = date(input.expiresOn);
    if (published && expires && expires < published)
      reject(400, "资料失效日期早于发布日期");
    const parts = chunks(content);
    if (parts.length > 150) reject(400, "资料片段过多，请拆分文档");
    return transaction(async (c) => {
      let documentId = id;
      if (id) {
        const [[old]] = await c.execute(
          "SELECT id FROM ai_documents WHERE id=? FOR UPDATE",
          [id],
        );
        if (!old) reject(404, "资料不存在");
        await c.execute(
          "UPDATE ai_documents SET title=?,content=?,region=?,published_on=?,expires_on=?,content_hash=?,version=version+1 WHERE id=?",
          [title, content, region, published, expires, hash(content), id],
        );
        await c.execute("DELETE FROM ai_chunks WHERE document_id=?", [id]);
      } else {
        const [result] = await c.execute(
          "INSERT INTO ai_documents(title,content,region,published_on,expires_on,content_hash,created_by) VALUES(?,?,?,?,?,?,?)",
          [title, content, region, published, expires, hash(content), user.id],
        );
        documentId = result.insertId;
      }
      for (let i = 0; i < parts.length; i++)
        await c.execute(
          "INSERT INTO ai_chunks(document_id,ordinal,section_title,content) VALUES(?,?,?,?)",
          [documentId, i, parts[i].section, parts[i].content],
        );
      return { id: documentId, chunks: parts.length };
    });
  }
  return { corpus, search, save };
}
module.exports = { createKnowledge };
