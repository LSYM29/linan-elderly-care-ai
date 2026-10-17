"use strict";
require("dotenv").config();
const fs = require("node:fs"),
  path = require("node:path");
const pool = require("../db");
const { createKnowledge } = require("../src/ai/knowledge");
async function init() {
  if (!/^linan_ai_/.test(process.env.DB_NAME || ""))
    throw Error("AI 迁移只允许独立 linan_ai_ 数据库");
  const statements = fs
    .readFileSync(path.join(__dirname, "../database/ai.sql"), "utf8")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sql of statements) await pool.query(sql);
  const [[exists]] = await pool.execute(
    "SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ai_faqs'",
  );
  if (!exists.n)
    await pool.query(
      `CREATE TABLE ai_faqs(id INT PRIMARY KEY AUTO_INCREMENT,question VARCHAR(150) NOT NULL,answer VARCHAR(1000) NOT NULL,category VARCHAR(50),sort_order INT NOT NULL DEFAULT 0,status TINYINT DEFAULT 1,created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,KEY idx_ai_faqs_status_sort(status,sort_order),KEY idx_ai_faqs_category(category)) ENGINE=InnoDB`,
    );
  const [[admin]] = await pool.execute(
    "SELECT id FROM users WHERE role='admin' AND status=1 ORDER BY id LIMIT 1",
  );
  if (!admin) throw Error("请先初始化业务数据库");
  const transaction = async (fn) => {
    const c = await pool.getConnection();
    try {
      await c.beginTransaction();
      const result = await fn(c);
      await c.commit();
      return result;
    } catch (e) {
      await c.rollback();
      throw e;
    } finally {
      c.release();
    }
  };
  const knowledge = createKnowledge({
    pool,
    transaction,
    reject: (s, m) => {
      throw Error(m);
    },
    cleanText: (v, l, o = {}) => {
      if (
        typeof v !== "string" ||
        (o.required && !v.trim()) ||
        v.length > (o.max || Infinity)
      )
        throw Error(l + "不正确");
      return v.trim();
    },
  });
  const documents = [
    {
      title: "邻安系统服务预约指南",
      content:
        "# 如何预约\n家属登录后可以查看已启用的服务项目。选择具体服务、未来的预约日期时间和详细服务地址，再提交预约。服务价格以系统当前项目为准。\n# 智能助手预约\n智能助手会先查询真实服务，再补齐时间、地址等信息，生成待确认草稿。草稿不是订单。用户点击确认预约，后端重新检查后才创建正式订单。草稿有效期为15分钟，重复确认同一草稿只返回同一订单。\n# 取消与评价\n家属仅可以取消待接单的预约。订单完成后可以进行一次1至5分评价。",
    },
    {
      title: "邻安系统角色与业务说明",
      content:
        "# 角色权限\n系统有家属、护理人员和管理员三类登录角色。老人是家属账号绑定的服务对象。家属仅查询自己的订单，护理人员在AI助手里仅查询分配给自己的任务，管理员按管理权限查询。\n# 履约流程\n订单提交后为待接单，护理人员接单后为已接单，开始服务后为服务中，填写服务记录后为已完成。各状态按规则流转。\n# 费用\n系统登记预约及服务价格，不提供在线支付；结算方式请向社区确认。",
    },
    {
      title: "知识库资料使用说明",
      content:
        "# 回答依据\n知识库只根据当前启用、未过期且地区适用的资料回答。回答中显示资料标题、章节和原文。没有依据时应说明无法从现有资料确定，不能编造政策金额或申请条件。\n# 政策资料\n演示库没有收录正式地方补贴政策。管理员可导入带地区和日期的TXT或Markdown正文。涉及具体政策请核对当地官方发布的信息。\n# 预约时间\n预约使用北京时间。用户只说“明天下午”时还缺少明确时刻，助手应继续询问，不能替用户选定具体小时。",
    },
  ];
  for (const input of documents) {
    const [[found]] = await pool.execute(
      "SELECT id FROM ai_documents WHERE title=?",
      [input.title],
    );
    if (!found) await knowledge.save(admin, input);
  }
  console.log("AI 表迁移及演示资料初始化完成，现有 ai_faqs 已复用。");
}
if (require.main === module)
  init()
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
module.exports = { init };
