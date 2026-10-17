require("dotenv").config();
process.env.TZ = "Asia/Shanghai";

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const pool = require("./db");
const { createOrderService } = require("./src/services/orders");

const app = express();
const PORT = Number(process.env.PORT || 3002);
const ROLES = ["admin", "family", "caregiver"];
const ORDER_STATUSES = ["待接单", "已接单", "服务中", "已完成", "已取消"];
const EMERGENCY_STATUSES = ["待处理", "处理中", "已解决"];

class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const asyncRoute = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);
const reject = (status, message, details) => {
  throw new AppError(status, message, details);
};

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "same-origin");
  next();
});
app.use("/api/ai/documents/extract", express.json({ limit: "8mb" }));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "linan-local-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 8 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  }),
);
app.use(express.static(path.join(__dirname, "public")));

async function refreshSessionUser(req) {
  if (!req.session.user) reject(401, "请先登录");
  const [[user]] = await pool.execute(
    "SELECT id,username,real_name,phone,role,status FROM users WHERE id=? LIMIT 1",
    [req.session.user.id],
  );
  if (!user || !user.status) {
    req.session.user = null;
    reject(401, "账号已停用或登录状态已失效，请重新登录");
  }
  req.session.user = {
    id: user.id,
    username: user.username,
    realName: user.real_name,
    phone: user.phone,
    role: user.role,
  };
  return req.session.user;
}

const requireLogin = asyncRoute(async (req, res, next) => {
  await refreshSessionUser(req);
  next();
});

function allowRoles(...roles) {
  return asyncRoute(async (req, res, next) => {
    const user = await refreshSessionUser(req);
    if (!roles.includes(user.role)) reject(403, "没有操作权限");
    next();
  });
}

function parseId(value, label = "记录编号") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) reject(400, `${label}不正确`);
  return id;
}

function cleanText(value, label, options = {}) {
  const {
    required = false,
    min = 0,
    max = 255,
    allowUndefined = false,
  } = options;
  if (value === undefined) {
    if (allowUndefined) return undefined;
    if (required) reject(400, `请填写${label}`);
    return "";
  }
  if (value === null || typeof value !== "string")
    reject(400, `${label}格式不正确`);
  const result = value.trim();
  if (required && !result) reject(400, `请填写${label}`);
  if (result && result.length < min)
    reject(400, `${label}至少需要${min}个字符`);
  if (result.length > max) reject(400, `${label}不能超过${max}个字符`);
  return result;
}

function parseRole(value, allowUndefined = false) {
  if (value === undefined && allowUndefined) return undefined;
  if (!ROLES.includes(value)) reject(400, "用户角色不正确");
  return value;
}

function parseStatusFlag(value, allowUndefined = false) {
  if (value === undefined && allowUndefined) return undefined;
  if (value === 1 || value === "1" || value === true) return 1;
  if (value === 0 || value === "0" || value === false) return 0;
  reject(400, "账号状态必须为0或1");
}

function validateUsername(value) {
  const username = cleanText(value, "用户名", {
    required: true,
    min: 3,
    max: 30,
  });
  if (!/^[A-Za-z0-9_]+$/.test(username))
    reject(400, "用户名只能包含字母、数字和下划线");
  return username;
}

function validatePassword(value) {
  const password = cleanText(value, "密码", {
    required: true,
    min: 6,
    max: 72,
  });
  return password;
}

function validatePhone(value, allowUndefined = false) {
  const phone = cleanText(value, "联系电话", { max: 20, allowUndefined });
  if (phone !== undefined && phone && !/^[0-9+\-\s]{6,20}$/.test(phone)) {
    reject(400, "联系电话格式不正确");
  }
  return phone;
}

function parseMoney(value, label = "价格") {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    typeof value === "boolean"
  )
    reject(400, `请填写${label}`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 99999999.99)
    reject(400, `${label}应为有效的非负数`);
  return Math.round(number * 100) / 100;
}

function parseInteger(
  value,
  label,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    typeof value === "boolean"
  )
    reject(400, `请填写${label}`);
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    reject(400, `${label}应为${min}至${max}之间的整数`);
  return number;
}

function parseDateOnly(
  value,
  label,
  { allowEmpty = true, future = false } = {},
) {
  if ((value === "" || value === null || value === undefined) && allowEmpty)
    return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    reject(400, `${label}格式应为YYYY-MM-DD`);
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    reject(400, `${label}不是有效日期`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!future && date > today) reject(400, `${label}不能晚于今天`);
  return value;
}

function toSqlDateTime(date) {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseAppointment(value) {
  if (typeof value !== "string" || !value.trim()) reject(400, "请填写预约时间");
  const normalized = value.trim().replace("T", " ");
  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) reject(400, "预约时间格式不正确");
  const [
    ,
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText = "0",
  ] = match;
  const [year, month, day, hour, minute, second] = [
    yearText,
    monthText,
    dayText,
    hourText,
    minuteText,
    secondText,
  ].map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    reject(400, "预约时间不是有效的日历时间");
  }
  if (date.getTime() <= Date.now()) reject(400, "预约时间必须晚于当前时间");
  if (date.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000)
    reject(400, "预约时间不能超过一年后");
  return toSqlDateTime(date);
}

function orderNumber() {
  const now = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `LA${timestamp}${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function elderProfile(body, partial = false) {
  const birthDate =
    body.birthDate !== undefined
      ? parseDateOnly(body.birthDate, "出生日期")
      : partial
        ? undefined
        : null;
  const gender =
    body.gender === undefined && partial ? undefined : body.gender || null;
  if (gender !== undefined && gender !== null && !["男", "女"].includes(gender))
    reject(400, "性别只能为男或女");
  return {
    gender,
    birthDate,
    address: cleanText(body.address, "居住地址", {
      max: 255,
      allowUndefined: partial,
    }),
    emergencyContact: cleanText(body.emergencyContact, "紧急联系人", {
      max: 50,
      allowUndefined: partial,
    }),
    emergencyPhone: validatePhone(body.emergencyPhone, partial),
    healthNotes: cleanText(body.healthNotes, "健康备注", {
      max: 5000,
      allowUndefined: partial,
    }),
  };
}

async function insertStatusLog(
  connection,
  orderId,
  fromStatus,
  toStatus,
  operatorId,
  note = "",
) {
  const safeNote = note ? String(note).slice(0, 500) : null;
  await connection.execute(
    `INSERT INTO order_status_logs (order_id,from_status,to_status,operator_id,action_note)
     VALUES (?,?,?,?,?)`,
    [orderId, fromStatus, toStatus, operatorId || null, safeNote],
  );
}

async function insertEmergencyStatusLog(
  connection,
  emergencyId,
  fromStatus,
  toStatus,
  operatorId,
  note = "",
) {
  const safeNote = note ? String(note).slice(0, 500) : null;
  await connection.execute(
    `INSERT INTO emergency_status_logs (emergency_id,from_status,to_status,operator_id,action_note)
     VALUES (?,?,?,?,?)`,
    [emergencyId, fromStatus, toStatus, operatorId || null, safeNote],
  );
}

app.post(
  "/api/login",
  asyncRoute(async (req, res) => {
    const username = cleanText(req.body.username, "用户名", {
      required: true,
      max: 50,
    });
    const password = cleanText(req.body.password, "密码", {
      required: true,
      max: 72,
    });
    const [rows] = await pool.execute(
      "SELECT id, username, password_hash, real_name, phone, role, status FROM users WHERE username=? LIMIT 1",
      [username],
    );
    const user = rows[0];
    if (
      !user ||
      !user.status ||
      !(await bcrypt.compare(password, user.password_hash))
    )
      reject(401, "用户名或密码错误");
    await new Promise((resolve, rejectSession) => {
      req.session.regenerate((error) =>
        error ? rejectSession(error) : resolve(),
      );
    });
    req.session.user = {
      id: user.id,
      username: user.username,
      realName: user.real_name,
      phone: user.phone,
      role: user.role,
    };
    res.json({ user: req.session.user });
  }),
);

app.post("/api/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("connect.sid");
    res.json({ message: "已退出登录" });
  });
});
app.get("/api/me", requireLogin, (req, res) =>
  res.json({ user: req.session.user }),
);

app.get(
  "/api/dashboard",
  requireLogin,
  asyncRoute(async (req, res) => {
    const user = req.session.user;
    let cards;
    let chartWhere = "";
    let chartParams = [];
    if (user.role === "admin") {
      const [[users], [elders], [orders], [pending]] = await Promise.all([
        pool.query("SELECT COUNT(*) total FROM users WHERE status=1"),
        pool.query(
          "SELECT COUNT(*) total FROM users WHERE role='family' AND status=1",
        ),
        pool.query("SELECT COUNT(*) total FROM service_orders"),
        pool.query(
          "SELECT COUNT(*) total FROM service_orders WHERE status IN ('待接单','已接单','服务中')",
        ),
      ]);
      cards = [
        { label: "系统用户", value: Number(users[0].total), icon: "people" },
        { label: "老人档案", value: Number(elders[0].total), icon: "elder" },
        { label: "服务订单", value: Number(orders[0].total), icon: "order" },
        { label: "待处理服务", value: Number(pending[0].total), icon: "clock" },
      ];
    } else {
      const field = user.role === "family" ? "elder_id" : "worker_id";
      chartWhere = `WHERE o.${field}=?`;
      chartParams = [user.id];
      const [[all], [active], [done]] = await Promise.all([
        pool.execute(
          `SELECT COUNT(*) total FROM service_orders WHERE ${field}=?`,
          [user.id],
        ),
        pool.execute(
          `SELECT COUNT(*) total FROM service_orders WHERE ${field}=? AND status IN ('待接单','已接单','服务中')`,
          [user.id],
        ),
        pool.execute(
          `SELECT COUNT(*) total FROM service_orders WHERE ${field}=? AND status='已完成'`,
          [user.id],
        ),
      ]);
      cards = [
        { label: "我的服务", value: Number(all[0].total), icon: "order" },
        { label: "进行中", value: Number(active[0].total), icon: "clock" },
        { label: "已完成", value: Number(done[0].total), icon: "check" },
      ];
    }

    const recentWhere = chartWhere
      ? `${chartWhere} AND o.created_at >= CURDATE() - INTERVAL 6 DAY`
      : "WHERE o.created_at >= CURDATE() - INTERVAL 6 DAY";
    const ratingWhere = chartWhere
      ? `${chartWhere} AND o.rating IS NOT NULL`
      : "WHERE o.rating IS NOT NULL";
    const [
      [notices],
      [categoryRows],
      [statusRows],
      [recentRows],
      [ratingRows],
    ] = await Promise.all([
      pool.query(`SELECT n.id,n.title,n.content,n.created_at,n.updated_at,u.real_name publisher_name
                FROM notices n JOIN users u ON u.id=n.publisher_id ORDER BY n.created_at DESC LIMIT 5`),
      pool.execute(
        `SELECT s.category name,COUNT(*) value FROM service_orders o
                  JOIN service_items s ON s.id=o.service_id ${chartWhere}
                  GROUP BY s.category ORDER BY value DESC`,
        chartParams,
      ),
      pool.execute(
        `SELECT o.status name,COUNT(*) value FROM service_orders o ${chartWhere}
                  GROUP BY o.status`,
        chartParams,
      ),
      pool.execute(
        `SELECT DATE_FORMAT(o.created_at,'%Y-%m-%d') date,COUNT(*) value
                  FROM service_orders o ${recentWhere}
                  GROUP BY DATE_FORMAT(o.created_at,'%Y-%m-%d') ORDER BY date`,
        chartParams,
      ),
      pool.execute(
        `SELECT o.rating name,COUNT(*) value FROM service_orders o ${ratingWhere}
                  GROUP BY o.rating ORDER BY o.rating`,
        chartParams,
      ),
    ]);

    const categories = categoryRows.map((row) => ({
      name: row.name,
      value: Number(row.value),
    }));
    const statusMap = new Map(
      statusRows.map((row) => [row.name, Number(row.value)]),
    );
    const statuses = ORDER_STATUSES.map((name) => ({
      name,
      value: statusMap.get(name) || 0,
    }));
    const recentMap = new Map(
      recentRows.map((row) => [row.date, Number(row.value)]),
    );
    const recent7Days = [];
    for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
      const date = new Date();
      date.setHours(12, 0, 0, 0);
      date.setDate(date.getDate() - daysAgo);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      recent7Days.push({
        date: key,
        label: `${date.getMonth() + 1}/${date.getDate()}`,
        value: recentMap.get(key) || 0,
      });
    }
    const ratingMap = new Map(
      ratingRows.map((row) => [Number(row.name), Number(row.value)]),
    );
    const ratingStats = [5, 4, 3, 2, 1].map((rating) => ({
      name: `${rating}星`,
      rating,
      value: ratingMap.get(rating) || 0,
    }));
    const ratingCount = ratingStats.reduce((sum, item) => sum + item.value, 0);
    const averageRating = ratingCount
      ? Number(
          (
            ratingStats.reduce(
              (sum, item) => sum + item.rating * item.value,
              0,
            ) / ratingCount
          ).toFixed(1),
        )
      : 0;
    res.json({
      cards,
      notices,
      charts: {
        serviceCategories: categories,
        categoryStats: categories,
        orderStatuses: statuses,
        statusStats: statuses,
        recent7Days,
        ratingStats,
        averageRating,
      },
    });
  }),
);

app.get(
  "/api/users",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const where = [];
    const params = [];
    if (req.query.role !== undefined && req.query.role !== "") {
      where.push("u.role=?");
      params.push(parseRole(req.query.role));
    }
    if (req.query.status !== undefined && req.query.status !== "") {
      where.push("u.status=?");
      params.push(parseStatusFlag(req.query.status));
    }
    if (req.query.keyword !== undefined && req.query.keyword !== "") {
      const keyword = cleanText(req.query.keyword, "关键词", { max: 50 });
      where.push("(u.username LIKE ? OR u.real_name LIKE ? OR u.phone LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const [rows] = await pool.execute(
      `SELECT u.id,u.username,u.real_name,u.real_name realName,u.phone,u.role,u.status,u.created_at,u.updated_at,
            e.gender,e.birth_date,e.address,e.emergency_contact,e.emergency_phone,e.health_notes
     FROM users u LEFT JOIN elder_profiles e ON e.user_id=u.id
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY u.created_at DESC,u.id DESC`,
      params,
    );
    res.json(rows);
  }),
);

app.post(
  "/api/users",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);
    const realName = cleanText(req.body.realName, "真实姓名", {
      required: true,
      max: 50,
    });
    const phone = validatePhone(req.body.phone);
    const role = parseRole(req.body.role);
    const status = parseStatusFlag(
      req.body.status === undefined ? 1 : req.body.status,
    );
    const profile = elderProfile(req.body, false);
    const id = await transaction(async (connection) => {
      const hash = await bcrypt.hash(password, 10);
      const [result] = await connection.execute(
        "INSERT INTO users (username,password_hash,real_name,phone,role,status) VALUES (?,?,?,?,?,?)",
        [username, hash, realName, phone || null, role, status],
      );
      if (role === "family") {
        await connection.execute(
          `INSERT INTO elder_profiles
         (user_id,gender,birth_date,address,emergency_contact,emergency_phone,health_notes)
         VALUES (?,?,?,?,?,?,?)`,
          [
            result.insertId,
            profile.gender,
            profile.birthDate,
            profile.address || null,
            profile.emergencyContact || null,
            profile.emergencyPhone || null,
            profile.healthNotes || null,
          ],
        );
      }
      return result.insertId;
    });
    res.status(201).json({ id, message: "用户创建成功" });
  }),
);

app.put(
  "/api/users/:id",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "用户编号");
    await transaction(async (connection) => {
      const [[current]] = await connection.execute(
        "SELECT * FROM users WHERE id=? FOR UPDATE",
        [id],
      );
      if (!current) reject(404, "用户不存在");
      const username =
        req.body.username === undefined
          ? current.username
          : validateUsername(req.body.username);
      const realName =
        req.body.realName === undefined
          ? current.real_name
          : cleanText(req.body.realName, "真实姓名", {
              required: true,
              max: 50,
            });
      const phone =
        req.body.phone === undefined
          ? current.phone
          : validatePhone(req.body.phone);
      const role =
        req.body.role === undefined ? current.role : parseRole(req.body.role);
      if (id === req.session.user.id && role !== current.role)
        reject(400, "不能修改当前登录账号的角色");
      if (current.role === "admin" && role !== "admin" && current.status) {
        const [[count]] = await connection.query(
          "SELECT COUNT(*) total FROM users WHERE role='admin' AND status=1 AND id<>?",
          [id],
        );
        if (!Number(count.total))
          reject(400, "系统必须至少保留一个启用的管理员账号");
      }
      await connection.execute(
        "UPDATE users SET username=?,real_name=?,phone=?,role=? WHERE id=?",
        [username, realName, phone || null, role, id],
      );
      if (role === "family") {
        await connection.execute(
          "INSERT INTO elder_profiles (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id=VALUES(user_id)",
          [id],
        );
      }
    });
    res.json({ message: "用户信息更新成功" });
  }),
);

app.put(
  "/api/users/:id/status",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "用户编号");
    const status = parseStatusFlag(req.body.status);
    await transaction(async (connection) => {
      const [[current]] = await connection.execute(
        "SELECT id,role,status FROM users WHERE id=? FOR UPDATE",
        [id],
      );
      if (!current) reject(404, "用户不存在");
      if (id === req.session.user.id && !status)
        reject(400, "不能停用当前登录账号");
      if (current.role === "admin" && current.status && !status) {
        const [[count]] = await connection.query(
          "SELECT COUNT(*) total FROM users WHERE role='admin' AND status=1 AND id<>?",
          [id],
        );
        if (!Number(count.total))
          reject(400, "系统必须至少保留一个启用的管理员账号");
      }
      await connection.execute("UPDATE users SET status=? WHERE id=?", [
        status,
        id,
      ]);
    });
    res.json({ message: status ? "账号已启用" : "账号已停用" });
  }),
);

app.put(
  "/api/users/:id/password",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "用户编号");
    const password = validatePassword(req.body.password);
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.execute(
      "UPDATE users SET password_hash=? WHERE id=?",
      [hash, id],
    );
    if (!result.affectedRows) reject(404, "用户不存在");
    res.json({ message: "密码重置成功" });
  }),
);

app.get(
  "/api/elders",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
    SELECT u.id,u.username,u.real_name,u.real_name realName,u.phone,u.status,
           e.gender,e.birth_date,e.address,e.emergency_contact,e.emergency_phone,e.health_notes
    FROM users u LEFT JOIN elder_profiles e ON e.user_id=u.id
    WHERE u.role='family' AND u.status=1 ORDER BY u.id DESC`);
    res.json(rows);
  }),
);

app.put(
  "/api/elders/:id",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "老人编号");
    const profile = elderProfile(req.body, true);
    await transaction(async (connection) => {
      const [[elder]] = await connection.execute(
        "SELECT * FROM users WHERE id=? AND role='family' FOR UPDATE",
        [id],
      );
      if (!elder) reject(404, "老人档案不存在");
      const realName =
        req.body.realName === undefined
          ? elder.real_name
          : cleanText(req.body.realName, "真实姓名", {
              required: true,
              max: 50,
            });
      const phone =
        req.body.phone === undefined
          ? elder.phone
          : validatePhone(req.body.phone);
      await connection.execute(
        "UPDATE users SET real_name=?,phone=? WHERE id=?",
        [realName, phone || null, id],
      );
      const [[existing]] = await connection.execute(
        "SELECT * FROM elder_profiles WHERE user_id=?",
        [id],
      );
      const values = {
        gender:
          profile.gender === undefined
            ? existing?.gender || null
            : profile.gender,
        birthDate:
          profile.birthDate === undefined
            ? existing?.birth_date || null
            : profile.birthDate,
        address:
          profile.address === undefined
            ? existing?.address || null
            : profile.address || null,
        emergencyContact:
          profile.emergencyContact === undefined
            ? existing?.emergency_contact || null
            : profile.emergencyContact || null,
        emergencyPhone:
          profile.emergencyPhone === undefined
            ? existing?.emergency_phone || null
            : profile.emergencyPhone || null,
        healthNotes:
          profile.healthNotes === undefined
            ? existing?.health_notes || null
            : profile.healthNotes || null,
      };
      await connection.execute(
        `INSERT INTO elder_profiles (user_id,gender,birth_date,address,emergency_contact,emergency_phone,health_notes)
       VALUES (?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE gender=VALUES(gender),birth_date=VALUES(birth_date),
       address=VALUES(address),emergency_contact=VALUES(emergency_contact),emergency_phone=VALUES(emergency_phone),health_notes=VALUES(health_notes)`,
        [
          id,
          values.gender,
          values.birthDate,
          values.address,
          values.emergencyContact,
          values.emergencyPhone,
          values.healthNotes,
        ],
      );
    });
    res.json({ message: "老人档案更新成功" });
  }),
);

app.get(
  "/api/services",
  requireLogin,
  asyncRoute(async (req, res) => {
    const user = req.session.user;
    const where = [];
    const params = [];
    if (user.role !== "admin") {
      where.push("status=1");
    } else if (req.query.status !== undefined && req.query.status !== "") {
      where.push("status=?");
      params.push(parseStatusFlag(req.query.status));
    }
    if (req.query.category !== undefined && req.query.category !== "") {
      where.push("category=?");
      params.push(cleanText(req.query.category, "服务分类", { max: 50 }));
    }
    if (req.query.keyword !== undefined && req.query.keyword !== "") {
      const keyword = cleanText(req.query.keyword, "关键词", { max: 50 });
      where.push("(name LIKE ? OR category LIKE ? OR description LIKE ?)");
      params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`);
    }
    const [rows] = await pool.execute(
      `SELECT * FROM service_items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY status DESC,id`,
      params,
    );
    res.json(rows);
  }),
);

function servicePayload(body, current = null) {
  return {
    name:
      body.name === undefined && current
        ? current.name
        : cleanText(body.name, "服务名称", { required: true, max: 100 }),
    category:
      body.category === undefined && current
        ? current.category
        : cleanText(body.category, "服务分类", { required: true, max: 50 }),
    description:
      body.description === undefined && current
        ? current.description || ""
        : cleanText(body.description, "服务说明", { max: 500 }),
    price:
      body.price === undefined && current
        ? Number(current.price)
        : parseMoney(body.price),
    durationMinutes:
      body.durationMinutes === undefined && current
        ? current.duration_minutes
        : parseInteger(body.durationMinutes, "服务时长", {
            min: 10,
            max: 1440,
          }),
  };
}

app.post(
  "/api/services",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const item = servicePayload(req.body);
    const [result] = await pool.execute(
      "INSERT INTO service_items (name,category,description,price,duration_minutes) VALUES (?,?,?,?,?)",
      [
        item.name,
        item.category,
        item.description,
        item.price,
        item.durationMinutes,
      ],
    );
    res.status(201).json({ id: result.insertId, message: "服务项目添加成功" });
  }),
);

app.put(
  "/api/services/:id",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "服务项目编号");
    const [[current]] = await pool.execute(
      "SELECT * FROM service_items WHERE id=?",
      [id],
    );
    if (!current) reject(404, "服务项目不存在");
    const item = servicePayload(req.body, current);
    await pool.execute(
      "UPDATE service_items SET name=?,category=?,description=?,price=?,duration_minutes=? WHERE id=?",
      [
        item.name,
        item.category,
        item.description,
        item.price,
        item.durationMinutes,
        id,
      ],
    );
    res.json({ message: "服务项目更新成功" });
  }),
);

app.put(
  "/api/services/:id/status",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "服务项目编号");
    const status = parseStatusFlag(req.body.status);
    const [result] = await pool.execute(
      "UPDATE service_items SET status=? WHERE id=?",
      [status, id],
    );
    if (!result.affectedRows) reject(404, "服务项目不存在");
    res.json({ message: status ? "服务项目已启用" : "服务项目已停用" });
  }),
);

app.get(
  "/api/notices",
  requireLogin,
  asyncRoute(async (req, res) => {
    const params = [];
    let where = "";
    if (req.query.keyword !== undefined && req.query.keyword !== "") {
      const keyword = cleanText(req.query.keyword, "关键词", { max: 50 });
      where = "WHERE n.title LIKE ? OR n.content LIKE ?";
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const [rows] = await pool.execute(
      `SELECT n.*,u.real_name publisher_name FROM notices n JOIN users u ON u.id=n.publisher_id ${where} ORDER BY n.created_at DESC`,
      params,
    );
    res.json(rows);
  }),
);

app.post(
  "/api/notices",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const title = cleanText(req.body.title, "公告标题", {
      required: true,
      max: 150,
    });
    const content = cleanText(req.body.content, "公告内容", {
      required: true,
      max: 10000,
    });
    const [result] = await pool.execute(
      "INSERT INTO notices (title,content,publisher_id) VALUES (?,?,?)",
      [title, content, req.session.user.id],
    );
    res.status(201).json({ id: result.insertId, message: "公告发布成功" });
  }),
);

app.put(
  "/api/notices/:id",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "公告编号");
    const [[current]] = await pool.execute("SELECT * FROM notices WHERE id=?", [
      id,
    ]);
    if (!current) reject(404, "公告不存在");
    const title =
      req.body.title === undefined
        ? current.title
        : cleanText(req.body.title, "公告标题", { required: true, max: 150 });
    const content =
      req.body.content === undefined
        ? current.content
        : cleanText(req.body.content, "公告内容", {
            required: true,
            max: 10000,
          });
    await pool.execute(
      "UPDATE notices SET title=?,content=?,publisher_id=? WHERE id=?",
      [title, content, req.session.user.id, id],
    );
    res.json({ message: "公告更新成功" });
  }),
);

app.delete(
  "/api/notices/:id",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "公告编号");
    const [result] = await pool.execute("DELETE FROM notices WHERE id=?", [id]);
    if (!result.affectedRows) reject(404, "公告不存在");
    res.json({ message: "公告删除成功" });
  }),
);

app.get(
  "/api/orders",
  requireLogin,
  asyncRoute(async (req, res) => {
    const user = req.session.user;
    const where = [];
    const params = [];
    if (user.role === "family") {
      where.push("o.elder_id=?");
      params.push(user.id);
    } else if (user.role === "caregiver") {
      where.push(
        "(o.worker_id=? OR (o.worker_id IS NULL AND o.status='待接单'))",
      );
      params.push(user.id);
    }
    if (req.query.status !== undefined && req.query.status !== "") {
      if (!ORDER_STATUSES.includes(req.query.status))
        reject(400, "订单状态不正确");
      where.push("o.status=?");
      params.push(req.query.status);
    }
    if (req.query.serviceId !== undefined && req.query.serviceId !== "") {
      where.push("o.service_id=?");
      params.push(parseId(req.query.serviceId, "服务项目编号"));
    }
    if (req.query.dateFrom !== undefined && req.query.dateFrom !== "") {
      const dateFrom = parseDateOnly(req.query.dateFrom, "开始日期", {
        future: true,
        allowEmpty: false,
      });
      where.push("o.appointment_time>=?");
      params.push(`${dateFrom} 00:00:00`);
    }
    if (req.query.dateTo !== undefined && req.query.dateTo !== "") {
      const dateTo = parseDateOnly(req.query.dateTo, "结束日期", {
        future: true,
        allowEmpty: false,
      });
      where.push("o.appointment_time<=?");
      params.push(`${dateTo} 23:59:59`);
    }
    if (
      req.query.dateFrom &&
      req.query.dateTo &&
      req.query.dateFrom > req.query.dateTo
    )
      reject(400, "开始日期不能晚于结束日期");
    if (req.query.keyword !== undefined && req.query.keyword !== "") {
      const keyword = cleanText(req.query.keyword, "关键词", { max: 80 });
      where.push(
        "(o.order_no LIKE ? OR s.name LIKE ? OR e.real_name LIKE ? OR COALESCE(w.real_name,'') LIKE ? OR o.service_address LIKE ? OR COALESCE(o.remark,'') LIKE ? OR COALESCE(o.service_record,'') LIKE ?)",
      );
      params.push(
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
      );
    }
    const [rows] = await pool.execute(
      `
    SELECT o.*,COALESCE(o.service_name_snapshot,s.name) service_name,
           COALESCE(o.service_category_snapshot,s.category) category,
           COALESCE(o.service_price_snapshot,s.price) price,
           COALESCE(o.service_duration_snapshot,s.duration_minutes) duration_minutes,
           e.real_name elder_name,e.phone elder_phone,w.real_name worker_name,w.phone worker_phone
    FROM service_orders o
    JOIN service_items s ON s.id=o.service_id
    JOIN users e ON e.id=o.elder_id
    LEFT JOIN users w ON w.id=o.worker_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY o.created_at DESC,o.id DESC`,
      params,
    );
    res.json(rows);
  }),
);

const orderService = createOrderService({
  parseId,
  parseAppointment,
  cleanText,
  reject,
  transaction,
  orderNumber,
  insertStatusLog,
});

app.post(
  "/api/orders",
  allowRoles("family"),
  asyncRoute(async (req, res) => {
    const id = await orderService.createServiceOrder({
      user: req.session.user,
      input: req.body,
      source: "web",
    });
    res.status(201).json({ id, message: "预约提交成功，请等待护理人员接单" });
  }),
);

app.put(
  "/api/orders/:id/status",
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "订单编号");
    const target = req.body.status;
    if (!ORDER_STATUSES.includes(target)) reject(400, "订单状态不正确");
    const user = req.session.user;
    const serviceRecord = cleanText(req.body.serviceRecord, "服务记录", {
      max: 5000,
    });
    const reason = cleanText(req.body.reason, "取消原因", { max: 500 });

    await transaction(async (connection) => {
      const [[order]] = await connection.execute(
        "SELECT * FROM service_orders WHERE id=? FOR UPDATE",
        [id],
      );
      if (!order) reject(404, "订单不存在");
      const from = order.status;
      let updateResult;
      let note = "";

      if (user.role === "caregiver") {
        const transitions = {
          待接单: "已接单",
          已接单: "服务中",
          服务中: "已完成",
        };
        if (transitions[from] !== target)
          reject(409, `订单当前为“${from}”，不能变更为“${target}”`);
        if (target === "已接单") {
          [updateResult] = await connection.execute(
            "UPDATE service_orders SET worker_id=?,status='已接单' WHERE id=? AND status='待接单' AND worker_id IS NULL",
            [user.id, id],
          );
          note = "护理人员接单";
        } else {
          if (order.worker_id !== user.id)
            reject(403, "只能处理分配给自己的订单");
          if (target === "已完成" && !serviceRecord)
            reject(400, "完成服务时请填写服务记录");
          [updateResult] = await connection.execute(
            "UPDATE service_orders SET status=?,service_record=? WHERE id=? AND worker_id=? AND status=?",
            [
              target,
              target === "已完成" ? serviceRecord : order.service_record,
              id,
              user.id,
              from,
            ],
          );
          note = target === "服务中" ? "护理人员开始服务" : serviceRecord;
        }
      } else if (user.role === "family") {
        if (order.elder_id !== user.id) reject(403, "只能操作本账号提交的订单");
        if (from !== "待接单" || target !== "已取消")
          reject(409, "只有待接单的订单可以取消");
        [updateResult] = await connection.execute(
          "UPDATE service_orders SET status='已取消' WHERE id=? AND elder_id=? AND status='待接单'",
          [id, user.id],
        );
        note = reason || "家属取消预约";
      } else if (user.role === "admin") {
        if (target !== "已取消" || !["待接单", "已接单"].includes(from))
          reject(409, "管理员只能取消待接单或已接单的订单");
        [updateResult] = await connection.execute(
          "UPDATE service_orders SET status='已取消' WHERE id=? AND status IN ('待接单','已接单')",
          [id],
        );
        note = reason || "管理员取消订单";
      } else {
        reject(403, "不能进行此操作");
      }

      if (!updateResult.affectedRows)
        reject(409, "订单状态已发生变化，请刷新后重试");
      await insertStatusLog(connection, id, from, target, user.id, note);
    });
    res.json({ message: "订单状态更新成功" });
  }),
);

app.get(
  "/api/orders/:id/logs",
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "订单编号");
    const [[order]] = await pool.execute(
      "SELECT id,elder_id,worker_id,status FROM service_orders WHERE id=?",
      [id],
    );
    if (!order) reject(404, "订单不存在");
    const user = req.session.user;
    const allowed =
      user.role === "admin" ||
      (user.role === "family" && order.elder_id === user.id) ||
      (user.role === "caregiver" && order.worker_id === user.id);
    if (!allowed) reject(403, "没有查看该订单记录的权限");
    const [rows] = await pool.execute(
      `SELECT l.*,u.real_name operator_name,u.role operator_role
     FROM order_status_logs l LEFT JOIN users u ON u.id=l.operator_id
     WHERE l.order_id=? ORDER BY l.created_at,l.id`,
      [id],
    );
    res.json(rows);
  }),
);

app.post(
  "/api/orders/:id/evaluation",
  allowRoles("family"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "订单编号");
    const rating = parseInteger(req.body.rating, "评分", { min: 1, max: 5 });
    const evaluation = cleanText(req.body.evaluation, "评价内容", { max: 500 });
    const [result] = await pool.execute(
      `UPDATE service_orders SET rating=?,evaluation=?,evaluated_at=NOW()
     WHERE id=? AND elder_id=? AND status='已完成' AND rating IS NULL`,
      [rating, evaluation || null, id, req.session.user.id],
    );
    if (!result.affectedRows) {
      const [[order]] = await pool.execute(
        "SELECT elder_id,status,rating FROM service_orders WHERE id=?",
        [id],
      );
      if (!order) reject(404, "订单不存在");
      if (order.elder_id !== req.session.user.id)
        reject(403, "只能评价本账号的订单");
      if (order.status !== "已完成") reject(400, "只有已完成的订单可以评价");
      if (order.rating !== null) reject(409, "该订单已经评价，不能重复评价");
      reject(409, "订单状态已发生变化，请刷新后重试");
    }
    res.json({ message: "感谢您的评价" });
  }),
);

app.post(
  "/api/emergencies",
  allowRoles("family"),
  asyncRoute(async (req, res) => {
    const location = cleanText(req.body.location, "当前位置", {
      required: true,
      max: 255,
    });
    const description = cleanText(req.body.description, "情况说明", {
      max: 500,
    });
    const id = await transaction(async (connection) => {
      const [result] = await connection.execute(
        "INSERT INTO emergency_calls (elder_id,location,description) VALUES (?,?,?)",
        [
          req.session.user.id,
          location,
          description || "家属为老人发起紧急求助",
        ],
      );
      await insertEmergencyStatusLog(
        connection,
        result.insertId,
        null,
        "待处理",
        req.session.user.id,
        "家属为老人提交紧急求助",
      );
      return result.insertId;
    });
    res
      .status(201)
      .json({ id, message: "求助信息已提交，社区工作人员会尽快联系您" });
  }),
);

app.get(
  "/api/emergencies",
  requireLogin,
  asyncRoute(async (req, res) => {
    const where = [];
    const params = [];
    if (req.session.user.role === "family") {
      where.push("e.elder_id=?");
      params.push(req.session.user.id);
    } else if (req.session.user.role !== "admin") {
      reject(403, "没有查看紧急求助记录的权限");
    }
    if (req.query.status !== undefined && req.query.status !== "") {
      if (!EMERGENCY_STATUSES.includes(req.query.status))
        reject(400, "求助状态不正确");
      where.push("e.status=?");
      params.push(req.query.status);
    }
    if (req.query.keyword !== undefined && req.query.keyword !== "") {
      const keyword = cleanText(req.query.keyword, "关键词", { max: 80 });
      where.push(
        "(u.real_name LIKE ? OR u.phone LIKE ? OR e.location LIKE ? OR e.description LIKE ?)",
      );
      params.push(
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
        `%${keyword}%`,
      );
    }
    const [rows] = await pool.execute(
      `SELECT e.*,u.real_name elder_name,u.phone,h.real_name handler_name
     FROM emergency_calls e JOIN users u ON u.id=e.elder_id
     LEFT JOIN users h ON h.id=e.handled_by
     ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY e.created_at DESC,e.id DESC`,
      params,
    );
    res.json(rows);
  }),
);

app.put(
  "/api/emergencies/:id/status",
  allowRoles("admin"),
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "求助记录编号");
    const target = req.body.status;
    if (!EMERGENCY_STATUSES.includes(target)) reject(400, "求助状态不正确");
    const handlingNote = cleanText(
      req.body.handlingNote !== undefined
        ? req.body.handlingNote
        : req.body.handleNote,
      "处理备注",
      { max: 500 },
    );
    await transaction(async (connection) => {
      const [[call]] = await connection.execute(
        "SELECT * FROM emergency_calls WHERE id=? FOR UPDATE",
        [id],
      );
      if (!call) reject(404, "紧急求助记录不存在");
      const nextStatus = { 待处理: "处理中", 处理中: "已解决" }[call.status];
      if (target !== nextStatus)
        reject(
          409,
          `求助当前为“${call.status}”，下一状态应为“${nextStatus || "无"}”`,
        );
      const note = handlingNote || call.handling_note || null;
      const [result] = await connection.execute(
        `UPDATE emergency_calls SET status=?,handling_note=?,handled_by=?,handled_at=?
       WHERE id=? AND status=?`,
        [
          target,
          note,
          req.session.user.id,
          target === "已解决" ? new Date() : null,
          id,
          call.status,
        ],
      );
      if (!result.affectedRows) reject(409, "求助状态已发生变化，请刷新后重试");
      await insertEmergencyStatusLog(
        connection,
        id,
        call.status,
        target,
        req.session.user.id,
        note ||
          (target === "处理中" ? "管理员受理求助" : "管理员确认求助已解决"),
      );
    });
    res.json({
      message: target === "已解决" ? "紧急求助已解决" : "紧急求助已受理",
    });
  }),
);

app.get(
  "/api/emergencies/:id/logs",
  requireLogin,
  asyncRoute(async (req, res) => {
    const id = parseId(req.params.id, "求助记录编号");
    const [[call]] = await pool.execute(
      "SELECT id,elder_id FROM emergency_calls WHERE id=?",
      [id],
    );
    if (!call) reject(404, "紧急求助记录不存在");
    if (
      req.session.user.role !== "admin" &&
      !(
        req.session.user.role === "family" &&
        call.elder_id === req.session.user.id
      )
    ) {
      reject(403, "没有查看该求助处理记录的权限");
    }
    const [rows] = await pool.execute(
      `SELECT l.*,u.real_name operator_name,u.role operator_role
     FROM emergency_status_logs l LEFT JOIN users u ON u.id=l.operator_id
     WHERE l.emergency_id=? ORDER BY l.created_at,l.id`,
      [id],
    );
    res.json(rows);
  }),
);

if (process.env.AI_ENABLED === "1") {
  require("./src/ai/routes").mountAi(app, {
    pool,
    requireLogin,
    allowRoles,
    asyncRoute,
    parseId,
    parseAppointment,
    cleanText,
    reject,
    transaction,
    orderService,
  });
}

app.use("/api", (req, res) =>
  res.status(404).json({ success: false, message: "接口不存在" }),
);
app.use((error, req, res, next) => {
  let status = error.status || 500;
  let message = error.message || "系统出现错误，请稍后重试";
  let publicServerMessage = "";
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
    status = 400;
    message = "请求内容不是有效的JSON";
  } else if (
    ["ECONNREFUSED", "PROTOCOL_CONNECTION_LOST", "ER_SERVER_SHUTDOWN"].includes(
      error.code,
    )
  ) {
    status = 503;
    publicServerMessage =
      "数据库服务未启动，请关闭本网页后重新双击“启动系统.bat”";
  } else if (error.code === "ER_DUP_ENTRY") {
    status = 409;
    message = error.sqlMessage?.includes("username")
      ? "用户名已存在"
      : "数据已存在，请勿重复提交";
  } else if (
    ["ER_NO_REFERENCED_ROW_2", "ER_ROW_IS_REFERENCED_2"].includes(error.code)
  ) {
    status = 409;
    message = "相关数据不存在或正在被使用，不能完成操作";
  } else if (
    [
      "ER_DATA_TOO_LONG",
      "WARN_DATA_TRUNCATED",
      "ER_TRUNCATED_WRONG_VALUE",
    ].includes(error.code)
  ) {
    status = 400;
    message = "提交的数据格式或长度不正确";
  }
  if (status >= 500) console.error(error);
  const aiMessage =
    req.path.startsWith("/api/ai/") && error.code?.startsWith("MODEL_")
      ? error.message
      : "";
  const payload = {
    success: false,
    message:
      status >= 500
        ? aiMessage || publicServerMessage || "系统出现错误，请稍后重试"
        : message,
  };
  if (error.details) payload.details = error.details;
  res.status(status).json(payload);
});

if (require.main === module) {
  app.listen(PORT, "127.0.0.1", () =>
    console.log(`邻安社区养老服务系统已启动：http://localhost:${PORT}`),
  );
}

module.exports = app;
