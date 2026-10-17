const state = {
  user: null,
  page: "dashboard",
  pageRequest: 0,
  modalResolver: null,
  lastFocus: null,
  filters: {
    users: { role: "", keyword: "", status: "" },
    elders: { keyword: "" },
    services: { keyword: "", category: "", status: "" },
    orders: {
      status: "",
      keyword: "",
      serviceId: "",
      dateFrom: "",
      dateTo: "",
    },
    notices: { keyword: "" },
    emergencies: { status: "", keyword: "" },
  },
  cache: {
    users: [],
    elders: [],
    services: [],
    orders: [],
    notices: [],
    emergencies: [],
  },
};

const roleText = { admin: "管理员", family: "家属", caregiver: "护理人员" };
const menus = {
  admin: [
    ["dashboard", "⌂", "工作台"],
    ["elders", "♙", "老人档案"],
    ["users", "♚", "用户管理"],
    ["services", "♡", "服务项目"],
    ["orders", "▤", "服务订单"],
    ["notices", "◈", "公告管理"],
    ["emergencies", "!", "紧急求助"],
  ],
  family: [
    ["dashboard", "⌂", "我的首页"],
    ["services", "♡", "预约服务"],
    ["orders", "▤", "我的订单"],
    ["emergency", "!", "紧急求助"],
  ],
  caregiver: [
    ["dashboard", "⌂", "工作台"],
    ["orders", "▤", "服务任务"],
    ["services", "♡", "服务项目"],
  ],
};
for (const menu of Object.values(menus))
  menu.splice(1, 0, ["assistant", "✧", "AI 服务助手"]);

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value = "") =>
  String(value).replace(
    /[&<>'"]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[char],
  );
const valueOf = (object, ...keys) => {
  for (const key of keys)
    if (object && object[key] !== undefined && object[key] !== null)
      return object[key];
  return "";
};
const asList = (result) => {
  if (Array.isArray(result)) return result;
  for (const key of ["items", "rows", "data", "list", "records"])
    if (Array.isArray(result?.[key])) return result[key];
  return [];
};
const dateText = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? escapeHtml(value)
    : date.toLocaleString("zh-CN", { hour12: false }).replaceAll("/", "-");
};
const dateOnly = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? escapeHtml(value)
    : date.toLocaleDateString("zh-CN").replaceAll("/", "-");
};
const inputDate = (value) => (value ? String(value).slice(0, 10) : "");
const localDateTimeValue = (date) => {
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const money = (value) =>
  Number.isFinite(Number(value)) ? Number(value).toFixed(2) : "0.00";
const activeOf = (value) => ![0, "0", false, "停用", "禁用"].includes(value);
const selected = (a, b) =>
  String(a ?? "") === String(b ?? "") ? " selected" : "";

async function api(url, options = {}) {
  const fetchOptions = { credentials: "same-origin", ...options };
  if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) {
    fetchOptions.headers = {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    };
  }
  let response;
  try {
    response = await fetch(url, fetchOptions);
  } catch {
    throw new Error("暂时无法连接服务器，请检查系统是否已启动");
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && state.user) showLogin();
  if (!response.ok) {
    const error = new Error(data.message || `请求失败（${response.status}）`);
    error.details = data.details;
    throw error;
  }
  return data;
}

function toast(message, type = "success") {
  const element = $("#toast");
  element.textContent = message || "操作成功";
  element.className = `toast show ${type}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.className = "toast";
  }, 2800);
}

function openModal(html, wide = false) {
  state.lastFocus = document.activeElement;
  $("#modalBody").innerHTML = html;
  $(".modal-card").classList.toggle("modal-wide", wide);
  $("#modal").classList.remove("hidden");
  $("#modal").setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  requestAnimationFrame(() =>
    $(
      "#modalBody input, #modalBody select, #modalBody textarea, #modalBody button",
    )?.focus(),
  );
}

function closeModal(result = false) {
  $("#modal").classList.add("hidden");
  $("#modal").setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  $(".modal-card").classList.remove("modal-wide");
  if (state.modalResolver) {
    const resolve = state.modalResolver;
    state.modalResolver = null;
    resolve(result);
  }
  state.lastFocus?.focus?.();
}

function confirmDialog(title, message, confirmText = "确认") {
  openModal(
    `<div class="confirm-dialog"><span class="confirm-icon">!</span><h3 id="modalTitle">${escapeHtml(title)}</h3><p>${escapeHtml(message)}</p><div class="modal-actions"><button class="secondary" type="button" id="confirmCancel">取消</button><button class="danger" type="button" id="confirmSubmit">${escapeHtml(confirmText)}</button></div></div>`,
  );
  return new Promise((resolve) => {
    state.modalResolver = resolve;
    $("#confirmCancel").onclick = () => closeModal(false);
    $("#confirmSubmit").onclick = () => closeModal(true);
  });
}

function wireForm(id, handler) {
  const form = $(`#${id}`);
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const original = button?.innerHTML;
    const errorBox = form.querySelector(".form-error");
    if (errorBox) errorBox.textContent = "";
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="button-loader"></span> 正在提交';
    }
    try {
      await handler(new FormData(form), form);
    } catch (error) {
      if (errorBox) errorBox.textContent = error.message;
      else toast(error.message, "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original;
      }
    }
  };
}

function queryString(values) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== "" && value !== null && value !== undefined)
      params.set(key, value);
  });
  return params.toString() ? `?${params}` : "";
}

function statusClass(status) {
  return (
    {
      待接单: "pending",
      已接单: "accepted",
      服务中: "working",
      已完成: "done",
      已取消: "cancel",
      待处理: "urgent",
      处理中: "working",
      已解决: "done",
      启用: "done",
      停用: "cancel",
    }[status] || ""
  );
}
const statusChip = (status) =>
  `<span class="status ${statusClass(status)}"><i></i>${escapeHtml(status || "未知")}</span>`;
const emptyState = (title = "暂无数据", detail = "当前还没有可显示的内容") =>
  `<div class="empty"><span>◇</span><b>${escapeHtml(title)}</b><p>${escapeHtml(detail)}</p></div>`;
const loadingState = () =>
  '<div class="loading-state"><span class="loader"></span><p>正在加载数据...</p></div>';
const errorState = (message) =>
  `<div class="empty error-state"><span>!</span><b>加载失败</b><p>${escapeHtml(message)}</p><button class="secondary" type="button" data-action="retry">重新加载</button></div>`;
const tableCell = (label, html) =>
  `<td data-label="${escapeHtml(label)}">${html}</td>`;

function setSidebar(open) {
  $(".sidebar").classList.toggle("open", open);
  $("#navBackdrop").classList.toggle("hidden", !open);
  $("#menuToggle").setAttribute("aria-expanded", String(open));
  $("#menuToggle").setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
}

function showLogin() {
  state.user = null;
  closeModal();
  setSidebar(false);
  $("#appPage").classList.add("hidden");
  $("#loginPage").classList.remove("hidden");
  $("#skipLink").setAttribute("href", "#loginForm");
  $("#password").value = "";
  $("#username").focus();
}

function showApp(user) {
  const realName =
    valueOf(user, "realName", "real_name") ||
    valueOf(user, "username") ||
    "用户";
  state.user = { ...user, realName };
  $("#loginPage").classList.add("hidden");
  $("#appPage").classList.remove("hidden");
  $("#skipLink").setAttribute("href", "#content");
  $("#realName").textContent = realName;
  $("#roleName").textContent = roleText[user.role] || "系统用户";
  $("#avatar").textContent = realName.slice(-1);
  $("#today").textContent = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const roleMenus = menus[user.role] || menus.family;
  $("#nav").innerHTML = roleMenus
    .map(
      ([id, icon, label]) =>
        `<button class="nav-item" type="button" data-page="${id}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span></button>`,
    )
    .join("");
  loadPage("dashboard");
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#loginMessage");
  const button = event.currentTarget.querySelector('[type="submit"]');
  const original = button.innerHTML;
  message.textContent = "";
  button.disabled = true;
  button.innerHTML = '<span class="button-loader"></span> 正在登录';
  try {
    const data = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#username").value.trim(),
        password: $("#password").value,
      }),
    });
    showApp(data.user);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
});

$$("[data-account]").forEach((button) => {
  button.onclick = () => {
    const [username, password] = button.dataset.account.split(",");
    $("#username").value = username;
    $("#password").value = password;
    $("#loginForm").requestSubmit();
  };
});
$("#logoutBtn").onclick = async () => {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    /* 本地仍退出 */
  }
  showLogin();
};
$("#menuToggle").onclick = () =>
  setSidebar(!$(".sidebar").classList.contains("open"));
$("#navBackdrop").onclick = () => setSidebar(false);
$("#nav").onclick = (event) => {
  const button = event.target.closest("[data-page]");
  if (button) {
    setSidebar(false);
    loadPage(button.dataset.page);
  }
};
document.addEventListener("click", (event) => {
  if (event.target.matches("[data-close]") || event.target.id === "modal")
    closeModal(false);
});
document.addEventListener("keydown", (event) => {
  if ($("#modal").classList.contains("hidden")) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeModal(false);
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = $$(
    '#modal button:not([disabled]), #modal input:not([disabled]), #modal select:not([disabled]), #modal textarea:not([disabled]), #modal [href], #modal [tabindex]:not([tabindex="-1"])',
  ).filter((element) => !element.closest(".hidden"));
  if (!focusable.length) return;
  const first = focusable[0],
    last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

async function loadPage(page) {
  const allowedPages = (menus[state.user.role] || []).map((item) => item[0]);
  if (!allowedPages.includes(page)) page = "dashboard";
  const requestId = ++state.pageRequest;
  state.page = page;
  $$(".nav-item").forEach((button) => {
    const active = button.dataset.page === page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const item = (menus[state.user.role] || []).find((menu) => menu[0] === page);
  $("#pageTitle").textContent = item?.[2] || "工作台";
  $("#content").innerHTML = loadingState();
  const renderers = {
    assistant: renderAssistant,
    dashboard: renderDashboard,
    users: renderUsers,
    elders: renderElders,
    services: renderServices,
    orders: renderOrders,
    notices: renderNotices,
    emergency: renderEmergency,
    emergencies: renderEmergencies,
  };
  try {
    if (!renderers[page]) throw new Error("页面不存在");
    await renderers[page]();
    if (requestId === state.pageRequest)
      $("#content").focus({ preventScroll: true });
  } catch (error) {
    if (requestId === state.pageRequest && state.page === page)
      $("#content").innerHTML = errorState(error.message);
  }
}

function statsToList(stats) {
  if (Array.isArray(stats)) return stats;
  if (stats && typeof stats === "object")
    return Object.entries(stats).map(([label, value]) => ({ label, value }));
  return [];
}

function chartBars(rows, kind) {
  const normalized = statsToList(rows).map((item) => ({
    label: valueOf(item, "label", "status", "category", "name") || "其他",
    value: Number(valueOf(item, "value", "count", "total", "order_count")) || 0,
  }));
  if (!normalized.length) return '<div class="chart-empty">暂无统计数据</div>';
  const max = Math.max(...normalized.map((item) => item.value), 1);
  return `<div class="bar-chart">${normalized.map((item) => `<div class="bar-row"><span title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span><div class="bar-track"><i class="${kind || ""}" style="width:${Math.max((item.value / max) * 100, item.value ? 5 : 0)}%"></i></div><b>${item.value}</b></div>`).join("")}</div>`;
}

function recentOrderList(rows) {
  if (!rows.length) return '<div class="chart-empty">暂无近期订单</div>';
  return `<div class="recent-list">${rows
    .slice(0, 5)
    .map(
      (order) =>
        `<div class="recent-item"><span class="recent-mark">${escapeHtml((valueOf(order, "service_name", "serviceName") || "服").slice(0, 1))}</span><div><b>${escapeHtml(valueOf(order, "service_name", "serviceName") || "养老服务")}</b><small>${escapeHtml(valueOf(order, "elder_name", "elderName") || valueOf(order, "order_no", "orderNo") || "—")}</small></div>${statusChip(valueOf(order, "status"))}</div>`,
    )
    .join("")}</div>`;
}

async function renderDashboard() {
  const data = await api("/api/dashboard");
  const cards = asList(data.cards || []),
    notices = asList(data.notices || []),
    charts = data.charts || {};
  const statusStats =
    charts.statusStats || charts.status_stats || data.statusStats || [];
  const categoryStats =
    charts.categoryStats || charts.category_stats || data.categoryStats || [];
  const recent7Days = asList(
    charts.recent7Days || charts.recent_7_days || data.recent7Days || [],
  );
  const ratingStats =
    charts.ratingStats || charts.rating_stats || data.ratingStats || [];
  const averageRating = Number(
    charts.averageRating ?? charts.average_rating ?? data.averageRating,
  );
  const greeting =
    state.user.role === "admin"
      ? "欢迎使用社区养老服务管理平台，及时处理服务订单和紧急求助。"
      : state.user.role === "caregiver"
        ? "细致护理，用心陪伴，请及时查看今天的服务任务。"
        : "邻里相伴，安享晚年。您可以在这里为绑定老人便捷预约社区养老服务。";
  const iconMap = {
    people: "♚",
    elder: "♙",
    order: "▤",
    clock: "◷",
    check: "✓",
    alert: "!",
    service: "♡",
  };
  $("#content").innerHTML = `
    <div class="welcome"><div><span class="welcome-kicker">今日概览</span><h3>${escapeHtml(state.user.realName)}，您好！</h3><p>${greeting}</p></div><div class="welcome-date"><b>${new Date().getDate()}</b><span>${new Date().toLocaleDateString("zh-CN", { month: "long" })}</span></div></div>
    <div class="stat-grid ${cards.length === 3 ? "three" : ""}">${cards.length ? cards.map((card) => `<div class="stat-card"><div class="stat-icon">${iconMap[card.icon] || "◇"}</div><div><b>${escapeHtml(card.value ?? 0)}</b><span>${escapeHtml(card.label || "统计")}</span></div></div>`).join("") : '<div class="stat-card stat-placeholder"><span>暂无概览数据</span></div>'}</div>
    <div class="dashboard-grid ${state.user.role === "admin" ? "charts-three" : ""}"><section class="panel chart-panel"><div class="panel-head"><div><span class="section-kicker">ORDER STATUS</span><h3>订单状态分布</h3></div></div>${chartBars(statusStats, "green")}</section><section class="panel chart-panel"><div class="panel-head"><div><span class="section-kicker">SERVICE CATEGORY</span><h3>服务类别统计</h3></div></div>${chartBars(categoryStats, "orange")}</section>${state.user.role === "admin" ? `<section class="panel chart-panel rating-panel"><div class="panel-head"><div><span class="section-kicker">SATISFACTION</span><h3>服务满意度</h3></div><div class="rating-average"><b>${Number.isFinite(averageRating) ? averageRating.toFixed(1) : "—"}</b><span>平均评分</span></div></div>${chartBars(ratingStats, "gold")}</section>` : ""}</div>
    <div class="dashboard-grid lower"><section class="panel"><div class="panel-head"><div><span class="section-kicker">COMMUNITY NEWS</span><h3>社区公告</h3></div><span class="badge">最新消息</span></div>${notices.length ? notices.map((notice) => `<article class="notice"><div><b>${escapeHtml(notice.title)}</b><p>${escapeHtml(notice.content)}</p></div><time>${dateOnly(notice.created_at || notice.createdAt)}</time></article>`).join("") : emptyState("暂无公告", "社区最新通知会显示在这里")}</section><section class="panel"><div class="panel-head"><div><span class="section-kicker">7-DAY TREND</span><h3>近 7 日订单趋势</h3></div><span class="badge">按创建日期</span></div>${chartBars(recent7Days, "blue")}</section></div>`;
}

function wireFilterForm(id, key, render) {
  const form = $(`#${id}`);
  if (!form) return;
  form.onsubmit = (event) => {
    event.preventDefault();
    state.filters[key] = {
      ...state.filters[key],
      ...Object.fromEntries(new FormData(form)),
    };
    render().catch((error) => {
      $("#content").innerHTML = errorState(error.message);
    });
  };
}

async function renderUsers() {
  const filters = state.filters.users;
  const rows = asList(await api(`/api/users${queryString(filters)}`));
  state.cache.users = rows;
  $("#content").innerHTML = `
    <div class="page-tools"><div><h3>系统用户</h3><p>管理管理员、家属和护理人员账号；老人作为服务对象维护档案</p></div><button class="primary" type="button" data-action="add-user">＋ 新增用户</button></div>
    <form id="userFilters" class="filter-bar"><label class="search-field"><span>⌕</span><input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="搜索姓名、账号或手机号"></label><select name="role" aria-label="角色筛选"><option value="">全部角色</option><option value="admin"${selected(filters.role, "admin")}>管理员</option><option value="family"${selected(filters.role, "family")}>家属</option><option value="caregiver"${selected(filters.role, "caregiver")}>护理人员</option></select><select name="status" aria-label="状态筛选"><option value="">全部状态</option><option value="1"${selected(filters.status, "1")}>启用</option><option value="0"${selected(filters.status, "0")}>停用</option></select><button class="primary" type="submit">查询</button><button class="ghost" type="button" data-action="reset-users">重置</button></form>
    <section class="panel table-panel"><div class="panel-head"><h3>用户列表</h3><span class="badge">共 ${rows.length} 人</span></div>${
      rows.length
        ? `<div class="table-wrap"><table><thead><tr><th>用户信息</th><th>角色</th><th>联系电话</th><th>账号状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>${rows
            .map((user) => {
              const id = valueOf(user, "id"),
                realName = valueOf(user, "real_name", "realName") || "未填写",
                username = valueOf(user, "username"),
                active = activeOf(valueOf(user, "status"));
              return `<tr>${tableCell("用户信息", `<div class="person-cell"><span>${escapeHtml(realName.slice(-1))}</span><div><b>${escapeHtml(realName)}</b><small>@${escapeHtml(username)}</small></div></div>`)}${tableCell("角色", `<span class="role-tag ${escapeHtml(user.role)}">${escapeHtml(roleText[user.role] || user.role || "未知")}</span>`)}${tableCell("联系电话", escapeHtml(valueOf(user, "phone") || "—"))}${tableCell("账号状态", statusChip(active ? "启用" : "停用"))}${tableCell("创建时间", dateOnly(valueOf(user, "created_at", "createdAt")))}${tableCell("操作", `<div class="row-actions"><button class="text-btn" type="button" data-action="edit-user" data-id="${id}">编辑</button><button class="text-btn" type="button" data-action="reset-password" data-id="${id}">重置密码</button>${Number(id) === Number(state.user.id) ? "" : `<button class="text-btn ${active ? "danger-text" : ""}" type="button" data-action="toggle-user" data-id="${id}">${active ? "停用" : "启用"}</button>`}</div>`)}</tr>`;
            })
            .join("")}</tbody></table></div>`
        : emptyState("未找到用户", "请调整筛选条件或新增用户")
    }</section>`;
  wireFilterForm("userFilters", "users", renderUsers);
}

function openUserForm(user = null, fixedRole = "", afterSave = renderUsers) {
  const editing = Boolean(user),
    realName = valueOf(user, "real_name", "realName"),
    role = fixedRole || valueOf(user, "role") || "family";
  const elderFields =
    !editing && fixedRole === "family"
      ? `<div class="form-section-title full">绑定老人档案信息</div><label>性别<select name="gender"><option value="">未填写</option><option value="男">男</option><option value="女">女</option></select></label><label>出生日期<input name="birthDate" type="date" max="${localDateTimeValue(new Date()).slice(0, 10)}"></label><label class="full">居住地址<input name="address" maxlength="255" placeholder="请输入小区、楼栋和房间号"></label><label>紧急联系人<input name="emergencyContact" maxlength="50"></label><label>联系人电话<input name="emergencyPhone" maxlength="20"></label><label class="full">健康备注<textarea name="healthNotes" maxlength="1000" placeholder="慢性病、过敏史、行动能力等"></textarea></label>`
      : "";
  openModal(
    `<h3 id="modalTitle">${editing ? "编辑用户" : fixedRole === "family" ? "新增家属账号及老人档案" : "新增系统用户"}</h3><p class="modal-subtitle">${editing ? "修改用户的基础资料和所属角色" : fixedRole === "family" ? "家属登录系统，为绑定老人预约和管理养老服务" : "创建后即可使用该账号登录系统"}</p><form id="userForm" class="form-grid">
    ${editing ? `<label class="full">登录账号<input value="${escapeHtml(valueOf(user, "username"))}" disabled><small>登录账号创建后不可修改</small></label>` : `<label>登录账号<input name="username" minlength="3" maxlength="30" pattern="[A-Za-z0-9_]+" autocomplete="off" required placeholder="3—30 位字母、数字或下划线"></label><label>初始密码<input name="password" type="password" minlength="6" maxlength="72" autocomplete="new-password" required placeholder="至少 6 位"></label>`}
    <label>${fixedRole === "family" ? "老人姓名" : "真实姓名"}<input name="realName" maxlength="50" value="${escapeHtml(realName)}" required></label><label>联系电话<input name="phone" maxlength="20" value="${escapeHtml(valueOf(user, "phone"))}" placeholder="请输入手机号"></label><label class="full">用户角色<select name="role" ${fixedRole ? "disabled" : ""}><option value="admin"${selected(role, "admin")}>管理员</option><option value="family"${selected(role, "family")}>家属</option><option value="caregiver"${selected(role, "caregiver")}>护理人员</option></select></label>${elderFields}
    <div class="form-error full"></div><div class="modal-actions full"><button class="secondary" type="button" data-close>取消</button><button class="primary" type="submit">${editing ? "保存修改" : "创建用户"}</button></div></form>`,
    fixedRole === "family",
  );
  wireForm("userForm", async (data) => {
    const body = Object.fromEntries(data);
    body.role = fixedRole || body.role;
    if (editing)
      await api(`/api/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    else
      await api("/api/users", { method: "POST", body: JSON.stringify(body) });
    closeModal();
    toast(editing ? "用户信息已更新" : "用户创建成功");
    await afterSave();
  });
}

function openPasswordForm(user) {
  openModal(
    `<h3 id="modalTitle">重置登录密码</h3><p class="modal-subtitle">正在为“${escapeHtml(valueOf(user, "real_name", "realName") || user.username)}”设置新密码</p><form id="passwordForm"><label>新密码<input name="password" type="password" minlength="6" maxlength="72" autocomplete="new-password" placeholder="至少 6 位" required></label><label>确认新密码<input name="confirmPassword" type="password" minlength="6" maxlength="72" autocomplete="new-password" required></label><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>取消</button><button class="primary" type="submit">确认重置</button></div></form>`,
  );
  wireForm("passwordForm", async (data) => {
    const password = data.get("password");
    if (password !== data.get("confirmPassword"))
      throw new Error("两次输入的密码不一致");
    if (password.length < 6) throw new Error("密码长度不能少于 6 位");
    await api(`/api/users/${user.id}/password`, {
      method: "PUT",
      body: JSON.stringify({ password }),
    });
    closeModal();
    toast("密码重置成功");
  });
}

async function renderElders() {
  const filters = state.filters.elders,
    allRows = asList(await api("/api/elders"));
  const keyword = filters.keyword.trim().toLowerCase();
  const rows = allRows.filter(
    (elder) =>
      !keyword ||
      `${valueOf(elder, "real_name", "realName")} ${valueOf(elder, "username")} ${valueOf(elder, "phone")} ${valueOf(elder, "address")} ${valueOf(elder, "emergency_contact", "emergencyContact")} ${valueOf(elder, "emergency_phone", "emergencyPhone")}`
        .toLowerCase()
        .includes(keyword),
  );
  state.cache.elders = rows;
  $("#content").innerHTML = `
    <div class="page-tools"><div><h3>社区老人档案</h3><p>维护老人基本信息、居住地址和健康备注</p></div><button class="primary" type="button" data-action="add-elder">＋ 新增老人</button></div>
    <form id="elderFilters" class="filter-bar compact"><label class="search-field"><span>⌕</span><input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="搜索姓名、电话或地址"></label><button class="primary" type="submit">查询</button><button class="ghost" type="button" data-action="reset-elders">重置</button></form>
    <section class="panel table-panel"><div class="panel-head"><h3>老人档案列表</h3><span class="badge">共 ${rows.length} 人</span></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>老人信息</th><th>性别 / 出生日期</th><th>居住地址</th><th>紧急联系人</th><th>健康备注</th><th>操作</th></tr></thead><tbody>${rows.map((elder) => `<tr>${tableCell("老人信息", `<div class="person-cell elder"><span>${escapeHtml((valueOf(elder, "real_name", "realName") || "老").slice(-1))}</span><div><b>${escapeHtml(valueOf(elder, "real_name", "realName") || "—")}</b><small>${escapeHtml(valueOf(elder, "phone") || "暂无电话")} · @${escapeHtml(valueOf(elder, "username") || "—")}</small></div></div>`)}${tableCell("性别 / 出生日期", `${escapeHtml(valueOf(elder, "gender") || "—")}<br><small>${dateOnly(valueOf(elder, "birth_date", "birthDate"))}</small>`)}${tableCell("居住地址", `<span class="wrap-text">${escapeHtml(valueOf(elder, "address") || "—")}</span>`)}${tableCell("紧急联系人", `${escapeHtml(valueOf(elder, "emergency_contact", "emergencyContact") || "—")}<br><small>${escapeHtml(valueOf(elder, "emergency_phone", "emergencyPhone") || "")}</small>`)}${tableCell("健康备注", `<span class="wrap-text clamp">${escapeHtml(valueOf(elder, "health_notes", "healthNotes") || "无特殊备注")}</span>`)}${tableCell("操作", `<button class="text-btn" type="button" data-action="edit-elder" data-id="${elder.id}">编辑档案</button>`)}</tr>`).join("")}</tbody></table></div>` : emptyState("暂无老人档案", "点击右上角新增老人档案，并创建关联家属账号")}</section>`;
  wireFilterForm("elderFilters", "elders", renderElders);
}

function openElderForm(elder) {
  openModal(
    `<h3 id="modalTitle">编辑老人档案</h3><p class="modal-subtitle">请及时维护联系方式、居住信息和健康情况</p><form id="elderForm" class="form-grid"><label>姓名<input name="realName" value="${escapeHtml(valueOf(elder, "real_name", "realName"))}" maxlength="50" required></label><label>联系电话<input name="phone" value="${escapeHtml(valueOf(elder, "phone"))}" maxlength="20"></label><label>性别<select name="gender"><option value="">未填写</option><option value="男"${selected(valueOf(elder, "gender"), "男")}>男</option><option value="女"${selected(valueOf(elder, "gender"), "女")}>女</option></select></label><label>出生日期<input name="birthDate" type="date" max="${localDateTimeValue(new Date()).slice(0, 10)}" value="${escapeHtml(inputDate(valueOf(elder, "birth_date", "birthDate")))}"></label><label class="full">居住地址<input name="address" value="${escapeHtml(valueOf(elder, "address"))}" maxlength="255"></label><label>紧急联系人<input name="emergencyContact" value="${escapeHtml(valueOf(elder, "emergency_contact", "emergencyContact"))}" maxlength="50"></label><label>联系人电话<input name="emergencyPhone" value="${escapeHtml(valueOf(elder, "emergency_phone", "emergencyPhone"))}" maxlength="20"></label><label class="full">健康备注<textarea name="healthNotes" maxlength="1000" placeholder="慢性病、过敏史、行动能力等">${escapeHtml(valueOf(elder, "health_notes", "healthNotes"))}</textarea></label><div class="form-error full"></div><div class="modal-actions full"><button class="secondary" type="button" data-close>取消</button><button class="primary" type="submit">保存档案</button></div></form>`,
    true,
  );
  wireForm("elderForm", async (data) => {
    await api(`/api/elders/${elder.id}`, {
      method: "PUT",
      body: JSON.stringify(Object.fromEntries(data)),
    });
    closeModal();
    toast("老人档案已更新");
    await renderElders();
  });
}

async function renderServices() {
  const admin = state.user.role === "admin",
    rows = asList(await api("/api/services"));
  state.cache.services = rows;
  const filters = state.filters.services,
    categories = [
      ...new Set(
        rows.map((service) => valueOf(service, "category")).filter(Boolean),
      ),
    ];
  const visible = rows.filter((service) => {
    const keyword = filters.keyword.trim().toLowerCase(),
      text =
        `${valueOf(service, "name")} ${valueOf(service, "category")} ${valueOf(service, "description")}`.toLowerCase(),
      active = activeOf(valueOf(service, "status"));
    return (
      (!keyword || text.includes(keyword)) &&
      (!filters.category || service.category === filters.category) &&
      (!filters.status || (filters.status === "1") === active)
    );
  });
  $("#content").innerHTML = `
    <div class="page-tools"><div><h3>社区养老服务</h3><p>${admin ? "维护服务内容、价格、时长和启用状态" : "选择您需要的服务，在线提交预约"}</p></div>${admin ? '<button class="primary" type="button" data-action="add-service">＋ 添加服务</button>' : ""}</div>
    <form id="serviceFilters" class="filter-bar"><label class="search-field"><span>⌕</span><input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="搜索服务名称或说明"></label><select name="category" aria-label="服务分类"><option value="">全部分类</option>${categories.map((category) => `<option value="${escapeHtml(category)}"${selected(filters.category, category)}>${escapeHtml(category)}</option>`).join("")}</select>${admin ? `<select name="status" aria-label="服务状态"><option value="">全部状态</option><option value="1"${selected(filters.status, "1")}>已启用</option><option value="0"${selected(filters.status, "0")}>已停用</option></select>` : ""}<button class="primary" type="submit">查询</button><button class="ghost" type="button" data-action="reset-services">重置</button></form><div class="result-summary"><span>找到 <b>${visible.length}</b> 个服务项目</span></div>
    ${
      visible.length
        ? `<div class="service-grid">${visible
            .map((service) => {
              const active = activeOf(valueOf(service, "status"));
              return `<article class="service-card ${active ? "" : "inactive"}"><div class="service-card-top"><span class="category">${escapeHtml(valueOf(service, "category") || "社区服务")}</span>${admin ? statusChip(active ? "启用" : "停用") : ""}</div><div class="service-symbol">${escapeHtml((valueOf(service, "name") || "服").slice(0, 1))}</div><h3>${escapeHtml(valueOf(service, "name"))}</h3><p>${escapeHtml(valueOf(service, "description") || "暂无服务说明")}</p><div class="service-meta"><div><span class="price">¥${money(valueOf(service, "price"))}<small> / 次</small></span><br><small class="muted">预计 ${escapeHtml(valueOf(service, "duration_minutes", "durationMinutes") || 60)} 分钟</small></div>${state.user.role === "family" ? `<button class="small-btn" type="button" data-action="book-service" data-id="${service.id}">立即预约</button>` : admin ? `<div class="row-actions"><button class="text-btn" type="button" data-action="edit-service" data-id="${service.id}">编辑</button><button class="text-btn ${active ? "danger-text" : ""}" type="button" data-action="toggle-service" data-id="${service.id}">${active ? "停用" : "启用"}</button></div>` : ""}</div></article>`;
            })
            .join("")}</div>`
        : emptyState("未找到服务项目", "请调整筛选条件后重试")
    }`;
  wireFilterForm("serviceFilters", "services", renderServices);
}

function openServiceForm(service = null) {
  const editing = Boolean(service);
  openModal(
    `<h3 id="modalTitle">${editing ? "编辑服务项目" : "添加服务项目"}</h3><p class="modal-subtitle">设置清晰的服务内容，便于老人和家属选择</p><form id="serviceForm" class="form-grid"><label>服务名称<input name="name" value="${escapeHtml(valueOf(service, "name"))}" maxlength="100" required></label><label>服务分类<input name="category" value="${escapeHtml(valueOf(service, "category"))}" maxlength="50" placeholder="如：生活照料" required></label><label>价格（元 / 次）<input name="price" type="number" min="0" max="99999" step="0.01" value="${escapeHtml(valueOf(service, "price") || "0")}" required></label><label>预计时长（分钟）<input name="durationMinutes" type="number" min="10" max="1440" value="${escapeHtml(valueOf(service, "duration_minutes", "durationMinutes") || "60")}" required></label><label class="full">服务说明<textarea name="description" maxlength="500" placeholder="介绍服务内容、适用对象和注意事项">${escapeHtml(valueOf(service, "description"))}</textarea></label><div class="form-error full"></div><div class="modal-actions full"><button class="secondary" type="button" data-close>取消</button><button class="primary" type="submit">保存服务</button></div></form>`,
  );
  wireForm("serviceForm", async (data) => {
    const body = Object.fromEntries(data);
    body.price = Number(body.price);
    body.durationMinutes = Number(body.durationMinutes);
    if (editing)
      await api(`/api/services/${service.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    else
      await api("/api/services", {
        method: "POST",
        body: JSON.stringify(body),
      });
    closeModal();
    toast(editing ? "服务项目已更新" : "服务项目添加成功");
    await renderServices();
  });
}

function openBooking(service) {
  const min = localDateTimeValue(new Date(Date.now() + 60 * 60 * 1000));
  openModal(
    `<h3 id="modalTitle">预约“${escapeHtml(service.name)}”</h3><p class="modal-subtitle">请填写准确的上门时间和服务地址</p><form id="bookingForm"><div class="booking-summary"><span>${escapeHtml(service.category || "社区服务")}</span><b>¥${money(service.price)} / 次</b></div><label>预约时间<input type="datetime-local" name="appointmentTime" min="${min}" required></label><label>服务地址<input name="serviceAddress" maxlength="255" placeholder="请输入楼栋、单元及门牌号" required></label><label>服务备注<textarea name="remark" maxlength="500" placeholder="可以说明身体情况、服务要求等"></textarea></label><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>取消</button><button class="primary" type="submit">提交预约</button></div></form>`,
  );
  wireForm("bookingForm", async (data) => {
    const appointmentTime = data.get("appointmentTime");
    if (new Date(appointmentTime).getTime() <= Date.now())
      throw new Error("预约时间必须晚于当前时间");
    const body = {
      serviceId: service.id,
      appointmentTime: appointmentTime.replace("T", " "),
      serviceAddress: data.get("serviceAddress").trim(),
      remark: data.get("remark").trim(),
    };
    const result = await api("/api/orders", {
      method: "POST",
      body: JSON.stringify(body),
    });
    closeModal();
    toast(result.message || "预约提交成功");
    await loadPage("orders");
  });
}

async function renderOrders() {
  const filters = state.filters.orders,
    serviceUrl = "/api/services";
  const [orderResult, serviceResult] = await Promise.all([
    api(`/api/orders${queryString(filters)}`),
    api(serviceUrl),
  ]);
  const rows = asList(orderResult),
    services = asList(serviceResult);
  state.cache.orders = rows;
  const heading =
    state.user.role === "caregiver"
      ? "待接与我的护理任务"
      : state.user.role === "family"
        ? "我的服务订单"
        : "全部服务订单";
  $("#content").innerHTML = `
    <div class="page-tools"><div><h3>${heading}</h3><p>${state.user.role === "caregiver" ? "请按流程接单、开始护理服务并填写服务记录" : "查询订单进度和服务详情"}</p></div></div>
    <form id="orderFilters" class="filter-bar orders-filter"><label class="search-field"><span>⌕</span><input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="订单号、服务或老人姓名"></label><select name="status"><option value="">全部状态</option>${["待接单", "已接单", "服务中", "已完成", "已取消"].map((status) => `<option value="${status}"${selected(filters.status, status)}>${status}</option>`).join("")}</select><select name="serviceId"><option value="">全部服务</option>${services.map((service) => `<option value="${service.id}"${selected(filters.serviceId, service.id)}>${escapeHtml(service.name)}</option>`).join("")}</select><label class="date-filter"><span>开始日期</span><input name="dateFrom" type="date" value="${escapeHtml(filters.dateFrom)}"></label><label class="date-filter"><span>结束日期</span><input name="dateTo" type="date" value="${escapeHtml(filters.dateTo)}"></label><button class="primary" type="submit">查询</button><button class="ghost" type="button" data-action="reset-orders">重置</button></form>
    <section class="panel table-panel"><div class="panel-head"><h3>订单列表</h3><span class="badge">共 ${rows.length} 条</span></div>${rows.length ? `<div class="table-wrap"><table><thead><tr><th>订单号 / 服务</th><th>老人</th><th>预约信息</th><th>护理人员</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.map((order) => `<tr>${tableCell("订单 / 服务", `<b>${escapeHtml(valueOf(order, "service_name", "serviceName") || "—")}</b><br><small class="mono">${escapeHtml(valueOf(order, "order_no", "orderNo"))}</small>`)}${tableCell("老人", escapeHtml(valueOf(order, "elder_name", "elderName") || "—"))}${tableCell("预约信息", `${dateText(valueOf(order, "appointment_time", "appointmentTime"))}<br><small class="wrap-text">${escapeHtml(valueOf(order, "service_address", "serviceAddress") || "—")}</small>`)}${tableCell("护理人员", escapeHtml(valueOf(order, "worker_name", "workerName") || "待安排"))}${tableCell("状态", statusChip(valueOf(order, "status")))}${tableCell("操作", orderActions(order))}</tr>`).join("")}</tbody></table></div>` : emptyState("暂无服务订单", state.user.role === "family" ? "预约服务后，订单会显示在这里" : "当前筛选条件下没有订单")}</section>`;
  wireFilterForm("orderFilters", "orders", renderOrders);
}

function orderActions(order) {
  const id = order.id,
    status = order.status;
  let mainAction = "";
  if (state.user.role === "caregiver" && status === "待接单")
    mainAction = `<button class="small-btn" type="button" data-action="order-status" data-id="${id}" data-status="已接单">接单</button>`;
  if (state.user.role === "caregiver" && status === "已接单")
    mainAction = `<button class="small-btn" type="button" data-action="order-status" data-id="${id}" data-status="服务中">开始服务</button>`;
  if (state.user.role === "caregiver" && status === "服务中")
    mainAction = `<button class="small-btn" type="button" data-action="complete-order" data-id="${id}">完成服务</button>`;
  if (state.user.role === "family" && status === "待接单")
    mainAction = `<button class="small-btn secondary" type="button" data-action="cancel-order" data-id="${id}">取消预约</button>`;
  if (
    state.user.role === "family" &&
    status === "已完成" &&
    !valueOf(order, "rating")
  )
    mainAction = `<button class="small-btn" type="button" data-action="rate-order" data-id="${id}">评价服务</button>`;
  if (state.user.role === "admin" && ["待接单", "已接单"].includes(status))
    mainAction = `<button class="text-btn danger-text" type="button" data-action="cancel-order" data-id="${id}">取消订单</button>`;
  return `<div class="row-actions">${mainAction}<button class="text-btn" type="button" data-action="order-detail" data-id="${id}">详情</button></div>`;
}

async function changeOrderStatus(order, status) {
  const messages = {
    已接单: [
      "确认接取任务",
      `确认接取“${valueOf(order, "service_name", "serviceName")}”服务任务吗？`,
    ],
    服务中: [
      "确认开始服务",
      "开始后订单将进入服务中状态，请确保已到达服务地点。",
    ],
    已取消: ["确认取消预约", "取消后该订单无法恢复，确定继续吗？"],
  };
  const [title, message] = messages[status] || [
    "确认更新状态",
    `确定将订单状态更新为“${status}”吗？`,
  ];
  if (!(await confirmDialog(title, message, "确认"))) return;
  const result = await api(`/api/orders/${order.id}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
  toast(result.message || "订单状态已更新");
  await renderOrders();
}

function openCompleteOrder(order) {
  openModal(
    `<h3 id="modalTitle">完成服务</h3><p class="modal-subtitle">请如实填写“${escapeHtml(valueOf(order, "service_name", "serviceName"))}”的服务记录</p><form id="completeForm"><label>服务记录<textarea name="serviceRecord" minlength="5" maxlength="1000" required placeholder="记录服务内容、老人情况和完成结果">已按预约内容完成上门服务，老人情况良好。</textarea></label><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>取消</button><button class="primary" type="submit">确认完成</button></div></form>`,
  );
  wireForm("completeForm", async (data) => {
    const result = await api(`/api/orders/${order.id}/status`, {
      method: "PUT",
      body: JSON.stringify({
        status: "已完成",
        serviceRecord: data.get("serviceRecord").trim(),
      }),
    });
    closeModal();
    toast(result.message || "服务已完成");
    await renderOrders();
  });
}

function openCancelOrder(order) {
  const admin = state.user.role === "admin";
  openModal(
    `<div class="sos-form-head cancel-head"><span>!</span><div><h3 id="modalTitle">${admin ? "取消服务订单" : "取消服务预约"}</h3><p>订单 ${escapeHtml(valueOf(order, "order_no", "orderNo"))} · ${escapeHtml(valueOf(order, "service_name", "serviceName"))}</p></div></div><form id="cancelOrderForm"><label>取消原因（选填）<textarea name="reason" maxlength="500" placeholder="请简要说明取消原因，便于社区后续跟进"></textarea></label><div class="form-hint">取消后无法恢复，如仍需服务请重新预约。</div><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>返回</button><button class="danger" type="submit">确认取消</button></div></form>`,
  );
  wireForm("cancelOrderForm", async (data) => {
    const result = await api(`/api/orders/${order.id}/status`, {
      method: "PUT",
      body: JSON.stringify({
        status: "已取消",
        reason: data.get("reason").trim(),
      }),
    });
    closeModal();
    toast(result.message || "订单已取消");
    await renderOrders();
  });
}

function openRating(order) {
  openModal(
    `<h3 id="modalTitle">评价服务</h3><p class="modal-subtitle">您的反馈将帮助社区持续提升服务质量</p><form id="ratingForm"><label>满意度<select name="rating"><option value="5">★★★★★ 非常满意</option><option value="4">★★★★☆ 满意</option><option value="3">★★★☆☆ 一般</option><option value="2">★★☆☆☆ 不满意</option><option value="1">★☆☆☆☆ 非常不满意</option></select></label><label>评价内容<textarea name="evaluation" maxlength="500" placeholder="请分享本次服务体验"></textarea></label><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>稍后评价</button><button class="primary" type="submit">提交评价</button></div></form>`,
  );
  wireForm("ratingForm", async (data) => {
    const result = await api(`/api/orders/${order.id}/evaluation`, {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data)),
    });
    closeModal();
    toast(result.message || "感谢您的评价");
    await renderOrders();
  });
}

async function openOrderDetail(order) {
  const rating = Number(valueOf(order, "rating"));
  const assignedToCaregiver =
    state.user.role !== "caregiver" ||
    Number(valueOf(order, "worker_id", "workerId")) === Number(state.user.id);
  let logs = [],
    logMessage = "";
  if (assignedToCaregiver) {
    try {
      logs = asList(await api(`/api/orders/${order.id}/logs`));
    } catch (error) {
      logMessage = error.message;
    }
  } else {
    logMessage = "接单后可查看完整状态记录";
  }
  const logHtml = logs.length
    ? `<ol class="status-timeline">${logs
        .map((log) => {
          const from = valueOf(log, "from_status", "fromStatus");
          const to = valueOf(log, "to_status", "toStatus");
          const operator =
            valueOf(log, "operator_name", "operatorName") || "系统";
          const operatorRole =
            roleText[valueOf(log, "operator_role", "operatorRole")] || "";
          return `<li><span class="timeline-dot"></span><div><div class="timeline-head"><b>${from ? `${escapeHtml(from)} → ${escapeHtml(to)}` : `创建订单 · ${escapeHtml(to)}`}</b><time>${dateText(valueOf(log, "created_at", "createdAt"))}</time></div><p>${escapeHtml(valueOf(log, "action_note", "actionNote") || "状态已更新")}</p><small>操作人：${escapeHtml(operator)}${operatorRole ? `（${escapeHtml(operatorRole)}）` : ""}</small></div></li>`;
        })
        .join("")}</ol>`
    : `<div class="chart-empty">${escapeHtml(logMessage || "暂无状态记录")}</div>`;
  openModal(
    `<h3 id="modalTitle">订单详情</h3><div class="detail-status">${statusChip(order.status)}<small>${escapeHtml(valueOf(order, "order_no", "orderNo"))}</small></div><dl class="detail-grid"><div><dt>服务项目</dt><dd>${escapeHtml(valueOf(order, "service_name", "serviceName") || "—")}</dd></div><div><dt>服务费用</dt><dd>¥${money(valueOf(order, "price"))}</dd></div><div><dt>预约老人</dt><dd>${escapeHtml(valueOf(order, "elder_name", "elderName") || "—")}<small>${escapeHtml(valueOf(order, "elder_phone", "elderPhone") || "")}</small></dd></div><div><dt>护理人员</dt><dd>${escapeHtml(valueOf(order, "worker_name", "workerName") || "待安排")}<small>${escapeHtml(valueOf(order, "worker_phone", "workerPhone") || "")}</small></dd></div><div class="full"><dt>预约时间</dt><dd>${dateText(valueOf(order, "appointment_time", "appointmentTime"))}</dd></div><div class="full"><dt>服务地址</dt><dd>${escapeHtml(valueOf(order, "service_address", "serviceAddress") || "—")}</dd></div><div class="full"><dt>预约备注</dt><dd>${escapeHtml(valueOf(order, "remark") || "无")}</dd></div><div class="full"><dt>服务记录</dt><dd>${escapeHtml(valueOf(order, "service_record", "serviceRecord") || "暂无")}</dd></div>${rating ? `<div class="full"><dt>服务评价</dt><dd><span class="stars" aria-label="${rating} 星评价">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span> ${escapeHtml(valueOf(order, "evaluation") || "")}<small>${dateText(valueOf(order, "evaluated_at", "evaluatedAt"))}</small></dd></div>` : ""}</dl><section class="timeline-section"><div class="panel-head"><h3>订单状态记录</h3><span class="badge">${logs.length} 条</span></div>${logHtml}</section><div class="modal-actions"><button class="primary" type="button" data-close>知道了</button></div>`,
    true,
  );
}

async function renderNotices() {
  const rows = asList(await api("/api/notices"));
  state.cache.notices = rows;
  const keyword = state.filters.notices.keyword.trim().toLowerCase(),
    visible = rows.filter(
      (notice) =>
        !keyword ||
        `${notice.title} ${notice.content}`.toLowerCase().includes(keyword),
    );
  $("#content").innerHTML =
    `<div class="page-tools"><div><h3>社区公告管理</h3><p>发布和维护面向家属、护理人员及老人服务对象的通知</p></div><button class="primary" type="button" data-action="add-notice">＋ 发布公告</button></div><form id="noticeFilters" class="filter-bar compact"><label class="search-field"><span>⌕</span><input name="keyword" value="${escapeHtml(state.filters.notices.keyword)}" placeholder="搜索公告标题或内容"></label><button class="primary" type="submit">查询</button><button class="ghost" type="button" data-action="reset-notices">重置</button></form><section class="notice-admin-list">${visible.length ? visible.map((notice) => `<article class="notice-admin-card"><div class="notice-date"><b>${new Date(valueOf(notice, "created_at", "createdAt")).getDate() || "—"}</b><span>${dateOnly(valueOf(notice, "created_at", "createdAt")).slice(0, 7)}</span></div><div class="notice-body"><div><h3>${escapeHtml(notice.title)}</h3><p>${escapeHtml(notice.content)}</p></div><small>发布人：${escapeHtml(valueOf(notice, "publisher_name", "publisherName") || "管理员")} · ${dateText(valueOf(notice, "created_at", "createdAt"))}</small></div><div class="notice-actions"><button class="text-btn" type="button" data-action="edit-notice" data-id="${notice.id}">编辑</button><button class="text-btn danger-text" type="button" data-action="delete-notice" data-id="${notice.id}">删除</button></div></article>`).join("") : emptyState("暂无社区公告", "点击“发布公告”创建第一条通知")}</section>`;
  wireFilterForm("noticeFilters", "notices", renderNotices);
}

function openNoticeForm(notice = null) {
  const editing = Boolean(notice);
  openModal(
    `<h3 id="modalTitle">${editing ? "编辑公告" : "发布社区公告"}</h3><p class="modal-subtitle">公告将展示在各角色的工作台首页</p><form id="noticeForm"><label>公告标题<input name="title" maxlength="150" value="${escapeHtml(valueOf(notice, "title"))}" required placeholder="请输入简明的公告标题"></label><label>公告内容<textarea name="content" maxlength="3000" required placeholder="请输入公告详细内容">${escapeHtml(valueOf(notice, "content"))}</textarea></label><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>取消</button><button class="primary" type="submit">${editing ? "保存修改" : "确认发布"}</button></div></form>`,
  );
  wireForm("noticeForm", async (data) => {
    const body = Object.fromEntries(data);
    if (editing)
      await api(`/api/notices/${notice.id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    else
      await api("/api/notices", { method: "POST", body: JSON.stringify(body) });
    closeModal();
    toast(editing ? "公告已更新" : "公告发布成功");
    await renderNotices();
  });
}

async function renderEmergency() {
  const rows = asList(await api("/api/emergencies"));
  state.cache.emergencies = rows;
  const records = rows.length
    ? `<div class="my-emergency-list">${rows.map((item) => `<article class="emergency-record"><div class="emergency-record-head"><div>${statusChip(item.status)}<b>${dateText(valueOf(item, "created_at", "createdAt"))}</b></div><small>求助编号 #${escapeHtml(item.id)}</small></div><dl><div><dt>求助位置</dt><dd>${escapeHtml(item.location || "—")}</dd></div><div><dt>情况说明</dt><dd>${escapeHtml(item.description || "—")}</dd></div><div><dt>处理进展</dt><dd>${escapeHtml(valueOf(item, "handling_note", "handlingNote") || (item.status === "待处理" ? "管理员将尽快联系您" : "社区已受理，请保持电话畅通"))}</dd></div>${valueOf(item, "handler_name", "handlerName") ? `<div><dt>处理人</dt><dd>${escapeHtml(valueOf(item, "handler_name", "handlerName"))}${valueOf(item, "handled_at", "handledAt") ? ` · ${dateText(valueOf(item, "handled_at", "handledAt"))}` : ""}</dd></div>` : ""}</dl><button class="text-btn emergency-detail-btn" type="button" data-action="emergency-detail" data-id="${item.id}">查看完整处理记录</button></article>`).join("")}</div>`
    : emptyState("暂无求助记录", "您发起的紧急求助会显示在这里");
  $("#content").innerHTML =
    `<div class="emergency-hero"><div class="sos-symbol">SOS</div><div><span class="section-kicker">EMERGENCY HELP</span><h3>需要紧急帮助？</h3><p>如遇身体不适、摔倒或其他紧急情况，请立即发出求助，管理员会尽快联系您。</p></div><button class="danger sos-button" type="button" data-action="send-sos">立即求助</button></div><div class="safety-grid"><section class="panel"><span class="safety-icon red">120</span><div><h3>医疗急救</h3><p>出现昏迷、胸痛、呼吸困难等危急情况，请立即拨打 120。</p></div></section><section class="panel"><span class="safety-icon blue">110</span><div><h3>报警求助</h3><p>遭遇人身安全威胁或其他治安情况，请同时拨打 110。</p></div></section></div><section class="panel tips-panel"><h3>求助使用提示</h3><ol><li>填写准确的楼栋、单元和房间号，便于相关人员快速到达。</li><li>简要描述身体状况或突发情况，并保持电话畅通。</li><li>系统求助不能替代专业急救，情况危急时请优先拨打急救电话。</li></ol></section><section class="panel my-emergencies"><div class="panel-head"><div><span class="section-kicker">MY REQUESTS</span><h3>我的求助记录</h3></div><button class="ghost" type="button" data-action="refresh-emergency">刷新进展</button></div>${records}</section>`;
}

function openSosForm() {
  openModal(
    `<div class="sos-form-head"><span>!</span><div><h3 id="modalTitle">提交紧急求助</h3><p>提交后请保持电话畅通</p></div></div><form id="sosForm"><label>当前位置<input name="location" maxlength="255" placeholder="如：幸福家园 3 栋 2 单元 301" required></label><label>情况说明<textarea name="description" maxlength="500" placeholder="请简单说明发生了什么"></textarea></label><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>取消</button><button class="danger" type="submit">确认发出求助</button></div></form>`,
  );
  wireForm("sosForm", async (data) => {
    const result = await api("/api/emergencies", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data)),
    });
    closeModal();
    toast(result.message || "求助信息已提交");
    await renderEmergency();
  });
}

async function renderEmergencies() {
  const rows = asList(await api("/api/emergencies"));
  state.cache.emergencies = rows;
  const filters = state.filters.emergencies,
    keyword = filters.keyword.trim().toLowerCase();
  const visible = rows.filter((item) => {
    const text =
      `${valueOf(item, "elder_name", "elderName")} ${item.phone || ""} ${item.location || ""} ${item.description || ""}`.toLowerCase();
    return (
      (!filters.status || item.status === filters.status) &&
      (!keyword || text.includes(keyword))
    );
  });
  const count = (status) =>
    rows.filter((item) => item.status === status).length;
  $("#content").innerHTML =
    `<div class="page-tools"><div><h3>紧急求助中心</h3><p>请优先处理待处理求助，并及时更新跟进状态</p></div><div class="emergency-counts"><span class="urgent">待处理 <b>${count("待处理")}</b></span><span>处理中 <b>${count("处理中")}</b></span><span class="resolved">已解决 <b>${count("已解决")}</b></span></div></div><form id="emergencyFilters" class="filter-bar compact"><label class="search-field"><span>⌕</span><input name="keyword" value="${escapeHtml(filters.keyword)}" placeholder="搜索老人、电话、位置或情况"></label><select name="status" aria-label="求助状态"><option value="">全部状态</option>${["待处理", "处理中", "已解决"].map((status) => `<option value="${status}"${selected(filters.status, status)}>${status}</option>`).join("")}</select><button class="primary" type="submit">查询</button><button class="ghost" type="button" data-action="reset-emergencies">重置</button></form><section class="panel table-panel"><div class="panel-head"><h3>求助记录</h3><span class="badge">共 ${visible.length} 条</span></div>${
      visible.length
        ? `<div class="table-wrap"><table><thead><tr><th>求助老人</th><th>联系电话</th><th>位置 / 情况</th><th>发起时间</th><th>处理记录</th><th>状态</th><th>操作</th></tr></thead><tbody>${visible
            .map((item) => {
              const handlingNote = valueOf(
                item,
                "handling_note",
                "handlingNote",
              );
              const handling =
                handlingNote || valueOf(item, "handler_name", "handlerName")
                  ? `<span class="wrap-text">${escapeHtml(handlingNote || "已受理")}</span><br><small>${escapeHtml(valueOf(item, "handler_name", "handlerName") || "管理员")}${valueOf(item, "handled_at", "handledAt") ? ` · ${dateText(valueOf(item, "handled_at", "handledAt"))}` : ""}</small>`
                  : '<span class="muted">尚未受理</span>';
              const statusAction =
                item.status === "待处理"
                  ? `<button class="small-btn danger" type="button" data-action="emergency-status" data-id="${item.id}" data-status="处理中">受理</button>`
                  : item.status === "处理中"
                    ? `<button class="small-btn" type="button" data-action="emergency-status" data-id="${item.id}" data-status="已解决">标记解决</button>`
                    : "";
              const operation = `<div class="row-actions">${statusAction}<button class="text-btn" type="button" data-action="emergency-detail" data-id="${item.id}">详情</button></div>`;
              return `<tr class="${item.status === "待处理" ? "urgent-row" : ""}">${tableCell("求助老人", `<b>${escapeHtml(valueOf(item, "elder_name", "elderName") || "—")}</b>`)}${tableCell("联系电话", `<a class="phone-link" href="tel:${escapeHtml(item.phone || "")}">${escapeHtml(item.phone || "—")}</a>`)}${tableCell("位置 / 情况", `<span class="wrap-text"><b>${escapeHtml(item.location || "—")}</b><br>${escapeHtml(item.description || "—")}</span>`)}${tableCell("发起时间", dateText(valueOf(item, "created_at", "createdAt")))}${tableCell("处理记录", handling)}${tableCell("状态", statusChip(item.status))}${tableCell("操作", operation)}</tr>`;
            })
            .join("")}</tbody></table></div>`
        : emptyState("暂无求助记录", "当前筛选条件下没有紧急求助")
    }</section>`;
  wireFilterForm("emergencyFilters", "emergencies", renderEmergencies);
}

function openEmergencyStatus(item, status) {
  const resolving = status === "已解决";
  openModal(
    `<div class="sos-form-head"><span>!</span><div><h3 id="modalTitle">${resolving ? "办结紧急求助" : "受理紧急求助"}</h3><p>${escapeHtml(valueOf(item, "elder_name", "elderName") || "老人")} · ${escapeHtml(item.phone || "暂无电话")}</p></div></div><div class="emergency-summary"><b>${escapeHtml(item.location || "未填写位置")}</b><p>${escapeHtml(item.description || "未填写情况说明")}</p></div><form id="emergencyStatusForm"><label>处理备注<textarea name="handlingNote" maxlength="500" ${resolving ? "required" : ""} placeholder="${resolving ? "请记录处理结果、老人当前情况等" : "如：已电话联系，已安排护理人员上门"}">${escapeHtml(valueOf(item, "handling_note", "handlingNote"))}</textarea></label><div class="form-error"></div><div class="modal-actions"><button class="secondary" type="button" data-close>取消</button><button class="${resolving ? "primary" : "danger"}" type="submit">${resolving ? "确认已解决" : "确认受理"}</button></div></form>`,
  );
  wireForm("emergencyStatusForm", async (data) => {
    const handlingNote = data.get("handlingNote").trim();
    if (resolving && handlingNote.length < 2) throw new Error("请填写处理结果");
    const result = await api(`/api/emergencies/${item.id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status, handlingNote }),
    });
    closeModal();
    toast(result.message || "求助状态已更新");
    await renderEmergencies();
  });
}

async function openEmergencyDetail(item) {
  const logs = asList(await api(`/api/emergencies/${item.id}/logs`));
  const logHtml = logs.length
    ? `<ol class="status-timeline">${logs
        .map((log) => {
          const from = valueOf(log, "from_status", "fromStatus");
          const to = valueOf(log, "to_status", "toStatus");
          const operator =
            valueOf(log, "operator_name", "operatorName") || "系统";
          const operatorRole =
            roleText[valueOf(log, "operator_role", "operatorRole")] || "";
          return `<li><span class="timeline-dot"></span><div><div class="timeline-head"><b>${from ? `${escapeHtml(from)} → ${escapeHtml(to)}` : `发起求助 · ${escapeHtml(to)}`}</b><time>${dateText(valueOf(log, "created_at", "createdAt"))}</time></div><p>${escapeHtml(valueOf(log, "action_note", "actionNote") || "处理状态已更新")}</p><small>操作人：${escapeHtml(operator)}${operatorRole ? `（${escapeHtml(operatorRole)}）` : ""}</small></div></li>`;
        })
        .join("")}</ol>`
    : '<div class="chart-empty">暂无处理记录</div>';
  openModal(
    `<h3 id="modalTitle">紧急求助详情</h3><div class="detail-status">${statusChip(item.status)}<small>求助编号 #${escapeHtml(item.id)}</small></div><dl class="detail-grid"><div class="full"><dt>求助老人</dt><dd>${escapeHtml(valueOf(item, "elder_name", "elderName") || state.user.realName)}<small>${escapeHtml(item.phone || state.user.phone || "")}</small></dd></div><div class="full"><dt>求助位置</dt><dd>${escapeHtml(item.location || "—")}</dd></div><div class="full"><dt>情况说明</dt><dd>${escapeHtml(item.description || "—")}</dd></div><div class="full"><dt>当前处理备注</dt><dd>${escapeHtml(valueOf(item, "handling_note", "handlingNote") || "暂无")}</dd></div></dl><section class="timeline-section"><div class="panel-head"><h3>处理进度</h3><span class="badge">${logs.length} 条</span></div>${logHtml}</section><div class="modal-actions"><button class="primary" type="button" data-close>知道了</button></div>`,
    true,
  );
}

async function handleAction(button) {
  const action = button.dataset.action,
    id = Number(button.dataset.id);
  const find = (cache) =>
    state.cache[cache].find((item) => Number(item.id) === id);
  if (action === "retry") return loadPage(state.page);
  if (action === "add-user") return openUserForm();
  if (action === "add-elder") return openUserForm(null, "family", renderElders);
  if (action === "edit-user") return openUserForm(find("users"));
  if (action === "reset-password") return openPasswordForm(find("users"));
  if (action === "toggle-user") {
    const user = find("users"),
      active = activeOf(user.status),
      next = active ? 0 : 1;
    if (
      !(await confirmDialog(
        `${active ? "停用" : "启用"}用户`,
        `${active ? "停用后该用户将无法登录系统" : "启用后该用户可恢复登录"}，确定继续吗？`,
        active ? "确认停用" : "确认启用",
      ))
    )
      return;
    await api(`/api/users/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status: next }),
    });
    toast(`用户已${active ? "停用" : "启用"}`);
    return renderUsers();
  }
  if (action === "edit-elder") return openElderForm(find("elders"));
  if (action === "add-service") return openServiceForm();
  if (action === "edit-service") return openServiceForm(find("services"));
  if (action === "toggle-service") {
    const service = find("services"),
      active = activeOf(service.status);
    if (
      !(await confirmDialog(
        `${active ? "停用" : "启用"}服务`,
        active
          ? "停用后老人将无法继续预约该服务，历史订单不受影响。"
          : "启用后该服务将重新开放预约。",
        "确认",
      ))
    )
      return;
    await api(`/api/services/${id}/status`, {
      method: "PUT",
      body: JSON.stringify({ status: active ? 0 : 1 }),
    });
    toast(`服务已${active ? "停用" : "启用"}`);
    return renderServices();
  }
  if (action === "book-service") return openBooking(find("services"));
  if (action === "order-status")
    return changeOrderStatus(find("orders"), button.dataset.status);
  if (action === "cancel-order") return openCancelOrder(find("orders"));
  if (action === "complete-order") return openCompleteOrder(find("orders"));
  if (action === "rate-order") return openRating(find("orders"));
  if (action === "order-detail") return openOrderDetail(find("orders"));
  if (action === "add-notice") return openNoticeForm();
  if (action === "edit-notice") return openNoticeForm(find("notices"));
  if (action === "delete-notice") {
    const notice = find("notices");
    if (
      !(await confirmDialog(
        "删除公告",
        `确定删除“${notice.title}”吗？删除后无法恢复。`,
        "确认删除",
      ))
    )
      return;
    await api(`/api/notices/${id}`, { method: "DELETE" });
    toast("公告已删除");
    return renderNotices();
  }
  if (action === "send-sos") return openSosForm();
  if (action === "refresh-emergency") return renderEmergency();
  if (action === "emergency-status")
    return openEmergencyStatus(find("emergencies"), button.dataset.status);
  if (action === "emergency-detail")
    return openEmergencyDetail(find("emergencies"));
  const resetMap = {
    "reset-users": [
      "users",
      { role: "", keyword: "", status: "" },
      renderUsers,
    ],
    "reset-elders": ["elders", { keyword: "" }, renderElders],
    "reset-services": [
      "services",
      { keyword: "", category: "", status: "" },
      renderServices,
    ],
    "reset-orders": [
      "orders",
      { status: "", keyword: "", serviceId: "", dateFrom: "", dateTo: "" },
      renderOrders,
    ],
    "reset-notices": ["notices", { keyword: "" }, renderNotices],
    "reset-emergencies": [
      "emergencies",
      { status: "", keyword: "" },
      renderEmergencies,
    ],
  };
  if (resetMap[action]) {
    const [key, values, render] = resetMap[action];
    state.filters[key] = values;
    return render();
  }
}

$("#content").addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  button.disabled = true;
  Promise.resolve(handleAction(button))
    .catch((error) => toast(error.message, "error"))
    .finally(() => {
      if (button.isConnected) button.disabled = false;
    });
});

(async () => {
  try {
    const data = await api("/api/me");
    showApp(data.user);
  } catch {
    showLogin();
  }
})();
