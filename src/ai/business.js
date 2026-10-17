"use strict";
const crypto = require("node:crypto");
function createBusiness({
  pool,
  transaction,
  reject,
  parseId,
  parseAppointment,
  cleanText,
  orderService,
}) {
  const assertFamily = (user) => {
    if (user.role !== "family") reject(403, "仅家属账号可使用该功能");
  };
  const json = (value) =>
    typeof value === "string" ? JSON.parse(value) : value;
  const serviceSnapshot = (s) => ({
    id: s.id,
    name: s.name,
    category: s.category,
    price: String(s.price),
    duration_minutes: s.duration_minutes,
  });
  async function services() {
    const [rows] = await pool.execute(
      "SELECT id,name,category,description,price,duration_minutes FROM service_items WHERE status=1 ORDER BY id LIMIT 100",
    );
    return rows;
  }
  async function profile(user) {
    assertFamily(user);
    const [[row]] = await pool.execute(
      "SELECT gender,birth_date,address FROM elder_profiles WHERE user_id=?",
      [user.id],
    );
    return row || null;
  }
  function date(value) {
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value)) ||
      new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value
    )
      reject(400, "查询日期无效");
    return value;
  }
  async function orders(user, args = {}) {
    const where = [],
      params = [];
    if (user.role === "family") {
      where.push("o.elder_id=?");
      params.push(user.id);
    } else if (user.role === "caregiver") {
      where.push("o.worker_id=?");
      params.push(user.id);
    } else if (user.role !== "admin") reject(403, "没有查询权限");
    if (args.status) {
      if (
        !["待接单", "已接单", "服务中", "已完成", "已取消"].includes(
          args.status,
        )
      )
        reject(400, "订单状态不正确");
      where.push("o.status=?");
      params.push(args.status);
    }
    if (args.dateFrom) {
      where.push("o.appointment_time>=?");
      params.push(date(args.dateFrom) + " 00:00:00");
    }
    if (args.dateTo) {
      where.push("o.appointment_time<=?");
      params.push(date(args.dateTo) + " 23:59:59");
    }
    if (args.dateFrom && args.dateTo && args.dateFrom > args.dateTo)
      reject(400, "日期范围不正确");
    if (args.orderId) {
      where.push("o.id=?");
      params.push(parseId(args.orderId));
    }
    const [rows] = await pool.execute(
      `SELECT o.id,o.order_no,o.status,o.appointment_time,o.service_record,COALESCE(o.service_name_snapshot,s.name) service_name,COALESCE(o.service_price_snapshot,s.price) price FROM service_orders o JOIN service_items s ON s.id=o.service_id ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY o.appointment_time DESC,o.id DESC LIMIT 20`,
      params,
    );
    return rows;
  }
  async function detail(user, args) {
    const id = parseId(args.orderId, "订单编号");
    const result = await orders(user, { orderId: id });
    if (!result.length) reject(404, "订单不存在或无权查看");
    return result[0];
  }
  function bookingInput(input) {
    return {
      serviceId: parseId(input.serviceId, "服务编号"),
      appointmentTime: parseAppointment(input.appointmentTime),
      serviceAddress: cleanText(input.serviceAddress, "服务地址", {
        required: true,
        min: 3,
        max: 255,
      }),
      remark: cleanText(input.remark, "备注", { max: 500 }),
    };
  }
  function draftDto(row) {
    return {
      id: row.id,
      service: json(row.service_snapshot),
      appointmentTime: row.appointment_time,
      serviceAddress: row.service_address,
      remark: row.remark || "",
      revision: row.revision,
      expiresAt: row.expires_at,
      status:
        row.status === "pending" &&
        new Date(row.expires_at).getTime() <= Date.now()
          ? "expired"
          : row.status,
      orderId: row.order_id,
    };
  }
  async function prepare(user, input, id) {
    assertFamily(user);
    const data = bookingInput(input);
    return transaction(async (c) => {
      let old;
      if (id) {
        [[old]] = await c.execute(
          "SELECT * FROM ai_action_drafts WHERE id=? AND user_id=? FOR UPDATE",
          [id, user.id],
        );
        if (!old) reject(404, "预约草稿不存在");
        if (old.status !== "pending") reject(409, "此草稿已经提交或取消");
        if (Number(input.revision) !== old.revision)
          reject(409, "草稿已更新，请刷新后再修改");
      }
      const [[service]] = await c.execute(
        "SELECT id,name,category,price,duration_minutes FROM service_items WHERE id=? AND status=1 FOR SHARE",
        [data.serviceId],
      );
      if (!service) reject(400, "服务不存在或已停用");
      const draftId = id || crypto.randomUUID();
      if (id)
        await c.execute(
          "UPDATE ai_action_drafts SET service_id=?,service_snapshot=?,appointment_time=?,service_address=?,remark=?,revision=revision+1,expires_at=DATE_ADD(NOW(),INTERVAL 15 MINUTE) WHERE id=?",
          [
            data.serviceId,
            JSON.stringify(serviceSnapshot(service)),
            data.appointmentTime,
            data.serviceAddress,
            data.remark || null,
            id,
          ],
        );
      else
        await c.execute(
          "INSERT INTO ai_action_drafts(id,user_id,service_id,service_snapshot,appointment_time,service_address,remark,expires_at) VALUES(?,?,?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 15 MINUTE))",
          [
            draftId,
            user.id,
            data.serviceId,
            JSON.stringify(serviceSnapshot(service)),
            data.appointmentTime,
            data.serviceAddress,
            data.remark || null,
          ],
        );
      const [[row]] = await c.execute(
        "SELECT * FROM ai_action_drafts WHERE id=?",
        [draftId],
      );
      return draftDto(row);
    });
  }
  async function getDraft(user, id) {
    assertFamily(user);
    const [[row]] = await pool.execute(
      "SELECT * FROM ai_action_drafts WHERE id=? AND user_id=?",
      [id, user.id],
    );
    if (!row) reject(404, "预约草稿不存在");
    return draftDto(row);
  }
  async function confirm(user, id, input) {
    assertFamily(user);
    if (input.confirm !== true) reject(400, "需要在确认卡片上明确确认预约");
    return transaction(async (c) => {
      const [[row]] = await c.execute(
        "SELECT *,expires_at<=NOW() expired FROM ai_action_drafts WHERE id=? AND user_id=? FOR UPDATE",
        [id, user.id],
      );
      if (!row) reject(404, "预约草稿不存在");
      if (row.status === "submitted") {
        const [[order]] = await c.execute(
          "SELECT id,order_no FROM service_orders WHERE id=? AND elder_id=?",
          [row.order_id, user.id],
        );
        return { ...order, replayed: true };
      }
      if (row.status !== "pending" || row.expired)
        reject(409, "草稿已取消或过期，请重新生成");
      if (Number(input.revision) !== row.revision)
        reject(409, "确认内容已更新，请查看最新草稿后确认");
      const orderId = await orderService.createServiceOrder({
        user,
        source: "ai",
        connection: c,
        expectedService: json(row.service_snapshot),
        input: {
          serviceId: row.service_id,
          appointmentTime:
            typeof row.appointment_time === "string"
              ? row.appointment_time
              : row.appointment_time.toLocaleString("sv-SE", {
                  timeZone: "Asia/Shanghai",
                }),
          serviceAddress: row.service_address,
          remark: row.remark || "",
        },
      });
      await c.execute(
        "UPDATE ai_action_drafts SET status='submitted',order_id=? WHERE id=?",
        [orderId, id],
      );
      const [[order]] = await c.execute(
        "SELECT id,order_no FROM service_orders WHERE id=?",
        [orderId],
      );
      return { ...order, replayed: false };
    });
  }
  async function cancel(user, id) {
    assertFamily(user);
    const [result] = await pool.execute(
      "UPDATE ai_action_drafts SET status='cancelled' WHERE id=? AND user_id=? AND status='pending'",
      [id, user.id],
    );
    if (!result.affectedRows) reject(409, "草稿不存在或已提交");
    return { message: "草稿已取消" };
  }
  const tools = {
    list_services: (_, a) => services(),
    get_my_elder_profile: (u, a) => profile(u),
    list_my_orders: orders,
    get_order_detail: detail,
    prepare_booking: prepare,
  };
  const allowed = {
    list_services: [],
    get_my_elder_profile: [],
    list_my_orders: ["status", "dateFrom", "dateTo"],
    get_order_detail: ["orderId"],
    prepare_booking: [
      "serviceId",
      "appointmentTime",
      "serviceAddress",
      "remark",
    ],
  };
  async function execute(user, name, args) {
    if (!Object.hasOwn(tools, name)) reject(400, "不支持的工具");
    if (
      !args ||
      Array.isArray(args) ||
      typeof args !== "object" ||
      Object.keys(args).some((k) => !allowed[name].includes(k))
    )
      reject(400, "工具参数不符合约定");
    return tools[name](user, args);
  }
  return {
    services,
    profile,
    orders,
    detail,
    prepare,
    getDraft,
    confirm,
    cancel,
    execute,
  };
}
module.exports = { createBusiness };
