"use strict";

const assert = require("node:assert/strict");

const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3000").replace(
  /\/$/,
  "",
);
const REQUEST_TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS || 10000);
const marker = `qa_${Date.now().toString(36)}`;

let passed = 0;
let admin;
let family;
let caregiver;
let testCaregiver;
let testCaregiverId;
let testServiceId;
let testNoticeId;
let testOrderId;

class ApiClient {
  constructor(name) {
    this.name = name;
    this.cookie = "";
  }

  async request(method, pathname, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers.Cookie = this.cookie;

    try {
      const response = await fetch(`${BASE_URL}${pathname}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: controller.signal,
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) this.cookie = setCookie.split(";", 1)[0];
      const text = await response.text();
      let data = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      return { status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  get(pathname) {
    return this.request("GET", pathname);
  }
  post(pathname, body) {
    return this.request("POST", pathname, body);
  }
  put(pathname, body) {
    return this.request("PUT", pathname, body);
  }
  delete(pathname) {
    return this.request("DELETE", pathname);
  }
}

function bodyText(response) {
  if (!response) return "无响应";
  if (typeof response.data === "string") return response.data;
  return JSON.stringify(response.data);
}

function expectStatus(response, expected, context) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  assert.ok(
    statuses.includes(response.status),
    `${context}：预期 HTTP ${statuses.join("/")}, 实际 HTTP ${response.status}，响应 ${bodyText(response)}`,
  );
  return response.data;
}

function expectId(data, context) {
  const id = Number(data && (data.id ?? data.data?.id));
  assert.ok(
    Number.isInteger(id) && id > 0,
    `${context}：响应中缺少有效 id，响应 ${JSON.stringify(data)}`,
  );
  return id;
}

async function step(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    console.error(`FAIL  ${name}`);
    console.error(`      ${error.message}`);
    throw error;
  }
}

async function login(client, username, password, role) {
  const response = await client.post("/api/login", { username, password });
  const data = expectStatus(response, 200, `${client.name}登录`);
  assert.equal(data?.user?.role, role, `${client.name}角色应为 ${role}`);
}

function futureSqlDate() {
  return new Date(Date.now() + 48 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

async function locateEmergencyId() {
  const response = await admin.get("/api/emergencies");
  const rows = expectStatus(response, 200, "查询紧急求助");
  assert.ok(Array.isArray(rows), "紧急求助列表应直接返回数组");
  const row = rows.find(
    (item) => item.description === `[自动化测试 ${marker}] 紧急求助状态流转`,
  );
  assert.ok(row, "未在管理员列表中找到刚创建的紧急求助");
  return Number(row.id);
}

async function bestEffortCleanup() {
  if (!admin) return;
  const cleanup = [];
  if (testNoticeId) cleanup.push(admin.delete(`/api/notices/${testNoticeId}`));
  if (testCaregiverId)
    cleanup.push(
      admin.put(`/api/users/${testCaregiverId}/status`, { status: 0 }),
    );
  if (testServiceId)
    cleanup.push(
      admin.put(`/api/services/${testServiceId}/status`, { status: 0 }),
    );
  if (testOrderId && family) {
    cleanup.push(
      family.put(`/api/orders/${testOrderId}/status`, { status: "已取消" }),
    );
  }
  if (!cleanup.length) return;
  await Promise.allSettled(cleanup);
}

async function main() {
  const major = Number(process.versions.node.split(".")[0]);
  assert.ok(
    major >= 18,
    `本测试要求 Node.js 18+，当前版本为 ${process.version}`,
  );

  console.log("邻安社区养老服务系统 API 冒烟测试");
  console.log(`目标地址：${BASE_URL}`);
  console.log(`测试标记：${marker}`);
  console.log(
    "说明：测试会新增带唯一标记的数据，并停用测试用户与测试服务；已完成订单和已解决求助会保留作为测试记录。\n",
  );

  const guest = new ApiClient("未登录用户");
  admin = new ApiClient("管理员");
  family = new ApiClient("家属");
  caregiver = new ApiClient("护理人员A");

  await step("系统首页可访问", async () => {
    expectStatus(await guest.get("/"), 200, "访问首页");
  });

  await step("未登录访问受保护接口返回 401", async () => {
    expectStatus(await guest.get("/api/me"), 401, "未登录访问 /api/me");
  });

  await step("管理员账号登录成功", () =>
    login(admin, "admin", "admin123", "admin"),
  );
  await step("家属账号登录成功", () =>
    login(family, "family", "family123", "family"),
  );
  await step("护理人员账号登录成功", () =>
    login(caregiver, "caregiver", "caregiver123", "caregiver"),
  );

  await step("角色权限越权访问返回 403", async () => {
    expectStatus(await family.get("/api/users"), 403, "家属访问用户管理");
    expectStatus(
      await caregiver.post("/api/services", {
        name: `越权服务_${marker}`,
        category: "自动化测试",
        price: 1,
        durationMinutes: 10,
      }),
      403,
      "护理人员新增服务",
    );
  });

  await step("服务项目列表可查询", async () => {
    const rows = expectStatus(
      await family.get("/api/services"),
      200,
      "查询服务项目",
    );
    assert.ok(Array.isArray(rows), "服务项目接口应直接返回数组");
    assert.ok(rows.length > 0, "服务项目列表不应为空");
  });

  await step("管理员可新增并编辑服务项目", async () => {
    const created = expectStatus(
      await admin.post("/api/services", {
        name: `接口测试服务_${marker}`,
        category: "自动化测试",
        description: `[${marker}] 可安全停用的测试服务`,
        price: 0.01,
        durationMinutes: 10,
      }),
      201,
      "新增服务项目",
    );
    testServiceId = expectId(created, "新增服务项目");

    expectStatus(
      await admin.put(`/api/services/${testServiceId}`, {
        name: `接口测试服务已更新_${marker}`,
        category: "自动化测试",
        description: `[${marker}] 已验证编辑功能`,
        price: 0.02,
        durationMinutes: 15,
      }),
      200,
      "编辑服务项目",
    );

    const services = expectStatus(
      await admin.get(
        `/api/services?status=1&keyword=${encodeURIComponent(marker)}`,
      ),
      200,
      "筛选测试服务项目",
    );
    assert.ok(
      Array.isArray(services) &&
        services.some(
          (item) =>
            Number(item.id) === testServiceId && item.name.includes("已更新"),
        ),
      "服务项目列表中未找到更新后的测试数据",
    );
  });

  const firstPassword = `QaA_${marker}`;
  const secondPassword = `QaB_${marker}`;
  const testUsername = `caregiver_${marker}`.slice(0, 48);

  await step("管理员可新增、编辑并重置护理人员密码", async () => {
    const created = expectStatus(
      await admin.post("/api/users", {
        username: testUsername,
        password: firstPassword,
        realName: `测试护理员_${marker}`,
        phone: `139${String(Date.now()).slice(-8)}`,
        role: "caregiver",
        status: 1,
      }),
      201,
      "新增测试护理人员",
    );
    testCaregiverId = expectId(created, "新增测试护理人员");

    expectStatus(
      await admin.put(`/api/users/${testCaregiverId}`, {
        realName: `测试护理员已更新_${marker}`,
        phone: `137${String(Date.now() + 1).slice(-8)}`,
        role: "caregiver",
      }),
      200,
      "编辑测试护理人员",
    );

    expectStatus(
      await admin.put(`/api/users/${testCaregiverId}/password`, {
        password: secondPassword,
      }),
      200,
      "重置测试护理人员密码",
    );

    const users = expectStatus(
      await admin.get(
        `/api/users?role=caregiver&status=1&keyword=${encodeURIComponent(marker)}`,
      ),
      200,
      "筛选测试用户",
    );
    assert.ok(
      Array.isArray(users) &&
        users.some(
          (item) =>
            Number(item.id) === testCaregiverId &&
            item.real_name.includes("已更新"),
        ),
      "用户列表中未找到更新后的测试用户",
    );

    const oldPasswordClient = new ApiClient("旧密码验证");
    expectStatus(
      await oldPasswordClient.post("/api/login", {
        username: testUsername,
        password: firstPassword,
      }),
      401,
      "旧密码登录",
    );

    testCaregiver = new ApiClient("护理人员B");
    await login(testCaregiver, testUsername, secondPassword, "caregiver");
  });

  await step("无效预约请求不会创建订单", async () => {
    const listUrl = `/api/orders?serviceId=${testServiceId}&keyword=${encodeURIComponent(marker)}`;
    const before = expectStatus(
      await admin.get(listUrl),
      200,
      "读取校验前订单",
    );
    const valid = {
      serviceId: testServiceId,
      appointmentTime: futureSqlDate(),
      serviceAddress: `[自动化测试 ${marker}] 无效请求不应保存`,
      remark: marker,
    };
    const cases = [
      { ...valid, appointmentTime: "2000-01-01 10:00:00" },
      { ...valid, appointmentTime: "2099-01-01 10:00:00" },
      { ...valid, serviceAddress: "短" },
      { ...valid, serviceId: -1 },
      { ...valid, remark: "超".repeat(501) },
    ];
    for (const body of cases)
      expectStatus(
        await family.post("/api/orders", body),
        400,
        "拒绝非法预约字段",
      );
    expectStatus(
      await caregiver.post("/api/orders", valid),
      403,
      "护理人员不能创建家属预约",
    );
    const after = expectStatus(await admin.get(listUrl), 200, "读取校验后订单");
    assert.deepEqual(
      after.map((order) => order.id),
      before.map((order) => order.id),
      "拒绝的请求不应留下订单",
    );
  });

  await step("家属可为老人创建未来时间的服务预约", async () => {
    expectStatus(
      await family.post("/api/orders", {
        serviceId: testServiceId,
        appointmentTime: "2027-02-30 10:00:00",
        serviceAddress: `[自动化测试 ${marker}] 非法日期测试地址`,
        remark: "此订单不应创建",
      }),
      400,
      "拒绝不存在的日历日期",
    );

    const familyUser = expectStatus(
      await family.get("/api/me"),
      200,
      "读取当前家属身份",
    ).user;
    const adminUser = expectStatus(
      await admin.get("/api/me"),
      200,
      "读取管理员身份",
    ).user;
    const created = expectStatus(
      await family.post("/api/orders", {
        serviceId: testServiceId,
        appointmentTime: futureSqlDate(),
        serviceAddress: `[自动化测试 ${marker}] 邻安社区测试地址`,
        remark: `[${marker}] API 冒烟测试订单`,
        elderId: adminUser.id,
        elder_id: adminUser.id,
        price: 999,
        service_price_snapshot: 999,
        status: "已完成",
        source: "ai",
      }),
      201,
      "创建服务预约",
    );
    testOrderId = expectId(created, "创建服务预约");

    const orders = expectStatus(
      await admin.get(
        `/api/orders?serviceId=${testServiceId}&keyword=${encodeURIComponent(marker)}`,
      ),
      200,
      "筛选测试订单",
    );
    assert.ok(
      Array.isArray(orders) &&
        orders.some((item) => Number(item.id) === testOrderId),
      "管理员筛选结果中未找到刚创建的测试订单",
    );
    const savedOrder = orders.find((item) => Number(item.id) === testOrderId);
    assert.equal(
      Number(savedOrder.elder_id),
      Number(familyUser.id),
      "订单归属必须来自登录会话，不能由正文伪造",
    );
    assert.equal(
      Number(savedOrder.price),
      0.02,
      "预约价格必须来自服务项目，不能由正文伪造",
    );
    assert.equal(savedOrder.status, "待接单", "不能通过正文跳过待接单状态");
    const initialLogs = expectStatus(
      await family.get(`/api/orders/${testOrderId}/logs`),
      200,
      "查询创建日志",
    );
    assert.equal(
      initialLogs[0]?.action_note,
      "家属提交服务预约",
      "普通接口不能通过正文伪造 AI 来源",
    );

    expectStatus(
      await admin.put(`/api/services/${testServiceId}`, {
        name: `接口测试服务二次更新_${marker}`,
        category: "自动化测试",
        description: `[${marker}] 用于验证历史订单快照`,
        price: 9.99,
        durationMinutes: 20,
      }),
      200,
      "预约后编辑服务项目",
    );
    const snapshotOrders = expectStatus(
      await admin.get(`/api/orders?keyword=${encodeURIComponent(marker)}`),
      200,
      "查询订单快照",
    );
    const snapshotOrder = snapshotOrders.find(
      (item) => Number(item.id) === testOrderId,
    );
    assert.equal(
      snapshotOrder?.service_name,
      `接口测试服务已更新_${marker}`,
      "历史订单应保留预约时服务名称",
    );
    assert.equal(
      Number(snapshotOrder?.price),
      0.02,
      "历史订单应保留预约时服务价格",
    );
  });

  let winningCaregiver;
  await step("并发接单只有一名护理人员成功", async () => {
    const [first, second] = await Promise.all([
      caregiver.put(`/api/orders/${testOrderId}/status`, { status: "已接单" }),
      testCaregiver.put(`/api/orders/${testOrderId}/status`, {
        status: "已接单",
      }),
    ]);
    const successful = [first, second].filter(
      (response) => response.status === 200,
    );
    assert.equal(
      successful.length,
      1,
      `并发接单应恰好成功一次，实际响应为 ${first.status} 和 ${second.status}`,
    );
    const rejected = first.status === 200 ? second : first;
    expectStatus(rejected, [400, 403, 409], "并发接单的失败请求");
    winningCaregiver = first.status === 200 ? caregiver : testCaregiver;
  });

  await step("重复接单和跨级完成均被阻止", async () => {
    expectStatus(
      await winningCaregiver.put(`/api/orders/${testOrderId}/status`, {
        status: "已接单",
      }),
      [400, 403, 409],
      "重复接单",
    );
    expectStatus(
      await winningCaregiver.put(`/api/orders/${testOrderId}/status`, {
        status: "已完成",
        serviceRecord: `[${marker}] 不应保存的跨级完成记录`,
      }),
      [400, 403, 409],
      "从已接单跨级到已完成",
    );
  });

  await step("订单可严格按 已接单→服务中→已完成 流转", async () => {
    expectStatus(
      await winningCaregiver.put(`/api/orders/${testOrderId}/status`, {
        status: "服务中",
      }),
      200,
      "开始服务",
    );
    expectStatus(
      await winningCaregiver.put(`/api/orders/${testOrderId}/status`, {
        status: "服务中",
      }),
      [400, 403, 409],
      "重复开始服务",
    );
    expectStatus(
      await winningCaregiver.put(`/api/orders/${testOrderId}/status`, {
        status: "已完成",
        serviceRecord: `[自动化测试 ${marker}]${"长服务记录".repeat(130)}`,
      }),
      200,
      "完成服务",
    );
    expectStatus(
      await winningCaregiver.put(`/api/orders/${testOrderId}/status`, {
        status: "服务中",
      }),
      [400, 403, 409],
      "已完成订单回退",
    );

    const logs = expectStatus(
      await family.get(`/api/orders/${testOrderId}/logs`),
      200,
      "查询订单状态日志",
    );
    assert.ok(Array.isArray(logs), "订单状态日志应直接返回数组");
    assert.deepEqual(
      logs.map((item) => item.to_status),
      ["待接单", "已接单", "服务中", "已完成"],
      "订单状态日志应完整记录创建、接单、开始和完成过程",
    );
  });

  await step("完成订单只能评价一次", async () => {
    expectStatus(
      await family.post(`/api/orders/${testOrderId}/evaluation`, {
        rating: 5,
        evaluation: `[自动化测试 ${marker}] 首次评价`,
      }),
      200,
      "首次评价",
    );
    expectStatus(
      await family.post(`/api/orders/${testOrderId}/evaluation`, {
        rating: 1,
        evaluation: `[自动化测试 ${marker}] 不应覆盖的重复评价`,
      }),
      [400, 409],
      "重复评价",
    );

    const dashboard = expectStatus(
      await admin.get("/api/dashboard"),
      200,
      "查询管理员统计",
    );
    assert.ok(
      Array.isArray(dashboard?.charts?.ratingStats),
      "工作台应返回满意度统计",
    );
    assert.ok(
      Number(dashboard?.charts?.averageRating) > 0,
      "工作台平均评分应包含刚提交的评价",
    );
  });

  let emergencyId;
  await step("家属可为老人提交紧急求助", async () => {
    const created = expectStatus(
      await family.post("/api/emergencies", {
        location: `[自动化测试 ${marker}] 测试位置`,
        description: `[自动化测试 ${marker}] 紧急求助状态流转`,
      }),
      201,
      "提交紧急求助",
    );
    emergencyId = Number(created?.id || 0) || (await locateEmergencyId());
    assert.ok(emergencyId > 0, "未取得紧急求助 id");

    const emergencies = expectStatus(
      await admin.get(
        `/api/emergencies?status=${encodeURIComponent("待处理")}&keyword=${encodeURIComponent(marker)}`,
      ),
      200,
      "筛选测试紧急求助",
    );
    assert.ok(
      Array.isArray(emergencies) &&
        emergencies.some((item) => Number(item.id) === emergencyId),
      "管理员筛选结果中未找到刚创建的紧急求助",
    );

    const ownEmergencies = expectStatus(
      await family.get("/api/emergencies"),
      200,
      "家属查询所绑定老人的求助进展",
    );
    assert.ok(
      Array.isArray(ownEmergencies) &&
        ownEmergencies.some((item) => Number(item.id) === emergencyId),
      "家属列表中未找到刚为老人提交的求助",
    );
  });

  await step("紧急求助可严格按 待处理→处理中→已解决 闭环", async () => {
    expectStatus(
      await admin.put(`/api/emergencies/${emergencyId}/status`, {
        status: "处理中",
        handlingNote: `[${marker}] 已电话联系老人`,
      }),
      200,
      "受理紧急求助",
    );
    expectStatus(
      await admin.put(`/api/emergencies/${emergencyId}/status`, {
        status: "已解决",
        handlingNote: `[${marker}] 社区人员已确认安全`,
      }),
      200,
      "解决紧急求助",
    );
    expectStatus(
      await admin.put(`/api/emergencies/${emergencyId}/status`, {
        status: "处理中",
      }),
      [400, 409],
      "已解决求助回退",
    );

    const logs = expectStatus(
      await family.get(`/api/emergencies/${emergencyId}/logs`),
      200,
      "家属查询求助状态日志",
    );
    assert.deepEqual(
      logs.map((item) => item.to_status),
      ["待处理", "处理中", "已解决"],
      "求助日志应完整记录提交、受理和解决过程",
    );
  });

  await step("管理员可新增、编辑、查询并删除测试公告", async () => {
    const created = expectStatus(
      await admin.post("/api/notices", {
        title: `自动化测试公告_${marker}`,
        content: `[${marker}] 此公告仅用于验证管理功能`,
      }),
      201,
      "新增公告",
    );
    testNoticeId = expectId(created, "新增公告");

    expectStatus(
      await admin.put(`/api/notices/${testNoticeId}`, {
        title: `自动化测试公告已更新_${marker}`,
        content: `[${marker}] 公告编辑功能已验证`,
      }),
      200,
      "编辑公告",
    );

    const notices = expectStatus(
      await admin.get("/api/notices"),
      200,
      "查询公告",
    );
    assert.ok(Array.isArray(notices), "公告列表应直接返回数组");
    assert.ok(
      notices.some(
        (item) =>
          Number(item.id) === testNoticeId && item.title.includes("已更新"),
      ),
      "公告列表中未找到更新后的测试公告",
    );

    expectStatus(
      await admin.delete(`/api/notices/${testNoticeId}`),
      200,
      "删除测试公告",
    );
    testNoticeId = null;
  });

  await step("管理员可停用测试服务和测试用户", async () => {
    expectStatus(
      await admin.put(`/api/services/${testServiceId}/status`, { status: 0 }),
      200,
      "停用测试服务",
    );
    const services = expectStatus(
      await family.get("/api/services"),
      200,
      "查询启用服务",
    );
    assert.ok(
      !services.some((item) => Number(item.id) === testServiceId),
      "停用服务不应出现在家属可预约服务列表",
    );

    expectStatus(
      await admin.put(`/api/users/${testCaregiverId}/status`, { status: 0 }),
      200,
      "停用测试用户",
    );
    const disabledClient = new ApiClient("停用用户验证");
    expectStatus(
      await disabledClient.post("/api/login", {
        username: testUsername,
        password: secondPassword,
      }),
      401,
      "停用用户登录",
    );
    expectStatus(
      await testCaregiver.get("/api/me"),
      401,
      "已登录用户被停用后的旧会话",
    );
  });

  console.log(`\n全部通过：${passed} 项。`);
  console.log("测试结论：核心接口、权限控制和主要业务闭环工作正常。");
}

(async () => {
  let exitCode = 0;
  try {
    await main();
  } catch (error) {
    exitCode = 1;
    if (error?.name === "AbortError") {
      console.error(`\n请求超时。请确认系统正在 ${BASE_URL} 运行。`);
    } else if (error?.cause?.code === "ECONNREFUSED") {
      console.error(`\n无法连接 ${BASE_URL}。请先启动系统，再运行测试。`);
    } else {
      console.error("\n测试未通过，请根据上方首个 FAIL 修复后重试。");
    }
  } finally {
    try {
      await bestEffortCleanup();
    } catch {
      /* 清理失败不覆盖原始测试结果。 */
    }
  }
  process.exitCode = exitCode;
})();
