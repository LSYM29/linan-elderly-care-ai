"use strict";

/**
 * 普通预约和 AI 预约确认共用的订单创建逻辑。
 * user 必须来自服务端已验证的登录会话，不能从请求正文或模型参数中读取。
 * 订单创建和状态日志写入在同一事务中完成。
 */
function createOrderService({
  parseId,
  parseAppointment,
  cleanText,
  reject,
  transaction,
  orderNumber,
  insertStatusLog,
}) {
  const actionNotes = {
    web: "家属提交服务预约",
    ai: "智能助手确认后提交服务预约",
  };

  async function createServiceOrder({
    user,
    input = {},
    source = "web",
    connection: suppliedConnection,
    expectedService,
  }) {
    if (
      !user ||
      !Number.isInteger(user.id) ||
      user.id <= 0 ||
      user.role !== "family"
    ) {
      reject(403, "只有已登录的家属账号可以提交预约");
    }
    if (!Object.hasOwn(actionNotes, source)) reject(400, "预约来源不正确");

    const serviceId = parseId(input.serviceId, "服务项目编号");
    const appointmentTime = parseAppointment(input.appointmentTime);
    const serviceAddress = cleanText(input.serviceAddress, "服务地址", {
      required: true,
      min: 3,
      max: 255,
    });
    const remark = cleanText(input.remark, "预约备注", { max: 500 });

    const execute = async (connection) => {
      const [[service]] = await connection.execute(
        "SELECT id,name,category,price,duration_minutes FROM service_items WHERE id=? AND status=1 FOR SHARE",
        [serviceId],
      );
      if (!service) reject(400, "所选服务项目不存在或已停用");
      if (
        expectedService &&
        ["name", "category", "price", "duration_minutes"].some(
          (key) => String(service[key]) !== String(expectedService[key]),
        )
      ) {
        reject(409, "服务内容或价格已变化，请修改草稿并重新确认");
      }
      const [[family]] = await connection.execute(
        "SELECT id FROM users WHERE id=? AND role='family' AND status=1 FOR SHARE",
        [user.id],
      );
      if (!family) reject(403, "当前家属账号已停用，不能预约服务");

      const [result] = await connection.execute(
        `INSERT INTO service_orders
         (order_no,elder_id,service_id,service_name_snapshot,service_category_snapshot,
          service_price_snapshot,service_duration_snapshot,appointment_time,service_address,remark)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          orderNumber(),
          user.id,
          serviceId,
          service.name,
          service.category,
          service.price,
          service.duration_minutes,
          appointmentTime,
          serviceAddress,
          remark || null,
        ],
      );
      await insertStatusLog(
        connection,
        result.insertId,
        null,
        "待接单",
        user.id,
        actionNotes[source],
      );
      return result.insertId;
    };
    return suppliedConnection
      ? execute(suppliedConnection)
      : transaction(execute);
  }

  return { createServiceOrder };
}

module.exports = { createOrderService };
