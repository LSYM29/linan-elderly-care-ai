"use strict";
let aiView = {
  sessionId: null,
  messages: [],
  busy: false,
  tab: "chat",
  owner: null,
};
function aiJson(value) {
  if (!value) return {};
  return typeof value === "string" ? JSON.parse(value) : value;
}
function aiDate(value) {
  if (!value) return "";
  const instant =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
      ? value.replace(" ", "T") + "+08:00"
      : value;
  return new Date(instant)
    .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
    .slice(0, 16);
}
async function renderAssistant() {
  if (aiView.owner !== state.user.id)
    aiView = {
      sessionId: null,
      messages: [],
      busy: false,
      tab: "chat",
      owner: state.user.id,
    };
  const [status, sessions] = await Promise.all([
    api("/api/ai/status"),
    api("/api/ai/sessions"),
  ]);
  if (state.page !== "assistant") return;
  $("#content").innerHTML =
    `<section class="ai-intro"><div><span class="ai-eyebrow">邻安智慧服务</span><h3>把服务交给一句话</h3><p>了解服务、查询进度、安排预约，每一步都有据可查。</p></div><span class="ai-model-badge">✧ ${escapeHtml(status.model)}</span></section>
 ${!status.configured ? `<p class="ai-config-notice" role="status">智能助手尚未配置模型密钥，暂时无法回答。${state.user.role === "admin" ? "请在服务器本地运行“配置API密钥.bat”，保存后重新启动系统。" : "请联系管理员完成配置；其他服务功能可以正常使用。"}</p>` : ""}
 <div class="ai-tabs"><button type="button" data-ai-tab="chat" class="${aiView.tab === "chat" ? "selected" : ""}">服务对话</button>${state.user.role === "admin" ? `<button type="button" data-ai-tab="knowledge" class="${aiView.tab === "knowledge" ? "selected" : ""}">知识资料</button><button type="button" data-ai-tab="results" class="${aiView.tab === "results" ? "selected" : ""}">运行与评测</button>` : ""}</div>
 <div id="aiTabContent"></div>`;
  $$("#content [data-ai-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        aiView.tab = b.dataset.aiTab;
        renderAssistant().catch((e) => toast(e.message, "error"));
      }),
  );
  if (aiView.tab === "knowledge") return renderAiKnowledge();
  if (aiView.tab === "results") return renderAiResults();
  $("#aiTabContent").innerHTML =
    `<div class="ai-workspace"><aside class="ai-history"><button type="button" id="aiNew" class="secondary wide">＋ 新建对话</button><p class="ai-history-label">最近对话</p><div class="ai-session-list">${sessions.map((s) => `<button type="button" data-ai-session="${escapeHtml(s.id)}" class="${s.id === aiView.sessionId ? "selected" : ""}">${escapeHtml(s.title)}</button>`).join("") || '<p class="muted">你的对话会保存在这里</p>'}</div><div class="ai-note"><b>你的信息有边界</b><p>按当前账号权限查询。预约先核对，再由你点击确认。</p></div></aside>
 <section class="ai-chat"><div id="aiMessages" class="ai-messages" role="log" aria-live="polite"></div><form id="aiForm" class="ai-compose"><label class="sr-only" for="aiMessage">输入问题</label><textarea id="aiMessage" maxlength="2000" rows="2" placeholder="例如：帮我预约明天下午三点的健康监测" ${aiView.busy ? "disabled" : ""}></textarea><div class="ai-compose-bottom"><label>资料地区 <input id="aiRegion" value="通用" maxlength="80" aria-label="资料适用地区"></label><span>Enter 发送 · Shift + Enter 换行</span><button type="submit" class="primary" ${aiView.busy ? "disabled" : ""}>${aiView.busy ? "正在回答…" : "发送 ↑"}</button></div><p class="ai-form-error" id="aiError" role="alert"></p></form></section></div>`;
  $("#aiNew").onclick = () => {
    if (aiView.busy) return;
    aiView.sessionId = null;
    aiView.messages = [];
    renderAssistant();
  };
  $$("[data-ai-session]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (aiView.busy) return;
        try {
          const rows = await api("/api/ai/sessions/" + b.dataset.aiSession);
          aiView.sessionId = b.dataset.aiSession;
          aiView.messages = rows.map((r) => ({
            role: r.role,
            content: r.content,
            payload: aiJson(r.payload),
          }));
          await Promise.all(
            aiView.messages.map(async (message) => {
              if (!message.payload?.draft || state.user.role !== "family")
                return;
              try {
                message.payload.draft = await api(
                  "/api/ai/drafts/" + message.payload.draft.id,
                );
              } catch {
                message.payload.draft.status = "cancelled";
              }
            }),
          );
          await renderAssistant();
        } catch (e) {
          toast(e.message, "error");
        }
      }),
  );
  $("#aiForm").onsubmit = (event) => {
    event.preventDefault();
    sendAiMessage();
  };
  $("#aiMessage").onkeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendAiMessage();
    }
  };
  paintAiMessages();
}
function paintAiMessages() {
  const container = $("#aiMessages");
  if (!container) return;
  if (!aiView.messages.length) {
    container.innerHTML = `<div class="ai-welcome"><div class="ai-spark">✧</div><h3>${escapeHtml(state.user.realName)}，今天需要什么帮助？</h3><p>我可以根据资料解释服务，也可以帮你查询真实业务。</p><div class="ai-prompts">${["服务怎么预约？", "有哪些可以预约的服务？", state.user.role === "caregiver" ? "我有哪些服务任务？" : "我的预约进展怎么样？", "帮我预约明天下午的健康监测"].map((q) => `<button type="button" data-ai-prompt="${escapeHtml(q)}">${escapeHtml(q)} <span>↗</span></button>`).join("")}</div><small>政策回答以资料出处为准。需要帮助时也可以联系社区工作人员。</small></div>`;
    $$("[data-ai-prompt]").forEach(
      (b) =>
        (b.onclick = () => {
          $("#aiMessage").value = b.dataset.aiPrompt;
          $("#aiMessage").focus();
        }),
    );
    return;
  }
  container.innerHTML =
    aiView.messages
      .map((m, index) => {
        const p = m.payload || {};
        return `<article class="ai-message ai-${m.role}"><span class="ai-avatar">${m.role === "user" ? "你" : "✧"}</span><div class="ai-message-body"><b>${m.role === "user" ? "我的问题" : "邻安助手"}</b><p class="ai-answer">${escapeHtml(m.content)}</p>${p.sources?.length ? `<details class="ai-sources"><summary>查看 ${p.sources.length} 条资料依据</summary>${p.sources.map((s) => `<div><b>[${escapeHtml(s.id)}] ${escapeHtml(s.title)}</b><small>${escapeHtml(s.section)} · ${escapeHtml(s.region || "通用")} · 版本 ${escapeHtml(s.version)}</small><p>${escapeHtml(s.content)}</p></div>`).join("")}</details>` : ""}${p.orders?.length ? `<div class="ai-order-list">${p.orders.map((o) => `<div><b>${escapeHtml(o.service_name)}</b><span>${escapeHtml(o.status)}</span><small>${escapeHtml(o.order_no)} · ${escapeHtml(aiDate(o.appointment_time))}</small><p>${escapeHtml(o.service_record || "暂无服务记录")}</p></div>`).join("")}<button type="button" class="text-btn" data-ai-orders>打开订单列表 →</button></div>` : ""}${p.draft ? aiDraftCard(p.draft, index) : ""}${p.runId ? `<small class="ai-run-label">${escapeHtml(p.model || "")} · 记录 ${escapeHtml(p.runId.slice(0, 8))}</small>` : ""}</div></article>`;
      })
      .join("") +
    (aiView.busy
      ? '<div class="ai-thinking"><span class="button-loader"></span> 正在检索资料并核对业务，请稍候…</div>'
      : "");
  $$("[data-ai-orders]").forEach((b) => (b.onclick = () => loadPage("orders")));
  $$("[data-ai-confirm]").forEach(
    (b) => (b.onclick = () => confirmAiDraft(Number(b.dataset.aiConfirm), b)),
  );
  $$("[data-ai-edit]").forEach(
    (b) => (b.onclick = () => editAiDraft(Number(b.dataset.aiEdit))),
  );
  $$("[data-ai-cancel]").forEach(
    (b) => (b.onclick = () => cancelAiDraft(Number(b.dataset.aiCancel))),
  );
  container.scrollTop = container.scrollHeight;
}
function aiDraftCard(d, index) {
  const pending = d.status === "pending";
  return `<section class="ai-draft"><div class="ai-draft-heading"><b>${pending ? "请核对预约信息" : d.status === "submitted" ? "预约已提交" : d.status === "expired" ? "草稿已过期" : "草稿已取消"}</b><span>${pending ? "待你确认" : "已处理"}</span></div><dl><div><dt>服务</dt><dd>${escapeHtml(d.service.name)}</dd></div><div><dt>时间</dt><dd>${escapeHtml(aiDate(d.appointmentTime))}（北京时间）</dd></div><div><dt>地址</dt><dd>${escapeHtml(d.serviceAddress)}</dd></div><div><dt>费用</dt><dd>¥ ${Number(d.service.price).toFixed(2)}</dd></div>${d.remark ? `<div><dt>备注</dt><dd>${escapeHtml(d.remark)}</dd></div>` : ""}</dl>${pending ? `<small>请于 ${escapeHtml(aiDate(d.expiresAt))} 前确认，逾期需重新生成。</small><div class="ai-draft-actions"><button type="button" class="primary" data-ai-confirm="${index}">确认预约</button><button type="button" class="secondary" data-ai-edit="${index}">修改信息</button><button type="button" class="text-btn" data-ai-cancel="${index}">取消草稿</button></div>` : `<small>${d.orderNo ? "订单号 " + escapeHtml(d.orderNo) : d.orderId ? "订单编号 " + d.orderId : "此草稿不会创建订单"}</small>`}</section>`;
}
async function sendAiMessage() {
  if (aiView.busy || state.page !== "assistant") return;
  const field = $("#aiMessage"),
    message = field.value.trim();
  if (!message) return;
  const region = $("#aiRegion").value.trim() || "通用";
  const requestOwner = state.user.id;
  field.value = "";
  aiView.messages.push({ role: "user", content: message });
  aiView.busy = true;
  $("#aiError").textContent = "";
  paintAiMessages();
  $("#aiForm button[type=submit]").disabled = true;
  field.disabled = true;
  try {
    const payload = await api("/api/ai/chat", {
      method: "POST",
      body: JSON.stringify({ message, sessionId: aiView.sessionId, region }),
    });
    if (state.user?.id !== requestOwner || aiView.owner !== requestOwner)
      return;
    aiView.sessionId = payload.sessionId;
    aiView.messages.push({
      role: "assistant",
      content: payload.answer,
      payload,
    });
  } catch (e) {
    if (state.user?.id !== requestOwner || aiView.owner !== requestOwner)
      return;
    if (e.details?.sessionId) aiView.sessionId = e.details.sessionId;
    if (state.page === "assistant") {
      $("#aiError").textContent = e.message;
      field.value = message;
    }
  } finally {
    if (aiView.owner === requestOwner) aiView.busy = false;
    if (state.page === "assistant" && aiView.owner === requestOwner) {
      paintAiMessages();
      $("#aiForm button[type=submit]").disabled = false;
      field.disabled = false;
      field.focus();
    }
  }
}
async function confirmAiDraft(index, button) {
  const draft = aiView.messages[index].payload.draft;
  button.disabled = true;
  try {
    const result = await api(`/api/ai/drafts/${draft.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ confirm: true, revision: draft.revision }),
    });
    Object.assign(draft, {
      status: "submitted",
      orderId: result.id,
      orderNo: result.order_no,
    });
    toast("预约提交成功");
    paintAiMessages();
  } catch (e) {
    toast(e.message, "error");
    button.disabled = false;
  }
}
async function cancelAiDraft(index) {
  const draft = aiView.messages[index].payload.draft;
  try {
    await api(`/api/ai/drafts/${draft.id}/cancel`, {
      method: "POST",
      body: "{}",
    });
    draft.status = "cancelled";
    paintAiMessages();
  } catch (e) {
    toast(e.message, "error");
  }
}
async function editAiDraft(index) {
  const d = aiView.messages[index].payload.draft;
  const services = asList(await api("/api/services"));
  openModal(
    `<h3 id="modalTitle">修改预约草稿</h3><form id="aiEditDraft"><label>服务项目<select name="serviceId">${services
      .filter((s) => Number(s.status) === 1)
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === d.service.id ? "selected" : ""}>${escapeHtml(s.name)} · ¥${Number(s.price).toFixed(2)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>预约时间<input name="appointmentTime" type="datetime-local" value="${escapeHtml(aiDate(d.appointmentTime).replace(" ", "T"))}" required></label><label>服务地址<input name="serviceAddress" value="${escapeHtml(d.serviceAddress)}" minlength="3" maxlength="255" required></label><label>备注<textarea name="remark" maxlength="500">${escapeHtml(d.remark)}</textarea></label><p class="form-error" role="alert"></p><button class="primary" type="submit">更新草稿并重新核对</button></form>`,
  );
  wireForm("aiEditDraft", async (data) => {
    const updated = await api(`/api/ai/drafts/${d.id}`, {
      method: "PUT",
      body: JSON.stringify({
        ...Object.fromEntries(data),
        revision: d.revision,
      }),
    });
    aiView.messages[index].payload.draft = updated;
    closeModal();
    paintAiMessages();
  });
}
async function renderAiKnowledge() {
  const rows = await api("/api/ai/documents");
  if (state.page !== "assistant" || aiView.tab !== "knowledge") return;
  $("#aiTabContent").innerHTML =
    `<section class="panel ai-admin-panel"><div class="panel-head"><div><h3>知识资料</h3><p>导入 TXT、Markdown 或可提取正文的 PDF，按地区、日期和状态控制检索范围。</p></div><button id="aiAddDocument" class="primary" type="button">＋ 添加资料</button></div><div class="ai-document-list">${rows.map((d) => `<article><div><h4>${escapeHtml(d.title)}</h4><p>${escapeHtml(d.region)} · 版本 ${d.version} · ${d.chunk_count} 个片段 · ${d.status ? "已启用" : "已停用"}</p><small>发布日期 ${d.published_on ? escapeHtml(String(d.published_on).slice(0, 10)) : "未指定"} · 失效日期 ${d.expires_on ? escapeHtml(String(d.expires_on).slice(0, 10)) : "未指定"}</small></div><div><button type="button" class="secondary" data-ai-doc-edit="${d.id}">查看与编辑</button><button type="button" class="text-btn" data-ai-doc-toggle="${d.id}">${d.status ? "停用" : "启用"}</button></div></article>`).join("")}</div><p class="muted">已有常见问题表继续参与检索。演示资料不代表正式地方政策。</p></section>`;
  $("#aiAddDocument").onclick = () => editAiDocument();
  $$("[data-ai-doc-edit]").forEach(
    (b) =>
      (b.onclick = () =>
        editAiDocument(rows.find((d) => d.id === Number(b.dataset.aiDocEdit)))),
  );
  $$("[data-ai-doc-toggle]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const d = rows.find((d) => d.id === Number(b.dataset.aiDocToggle));
          await api(`/api/ai/documents/${d.id}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: d.status ? 0 : 1 }),
          });
          renderAiKnowledge();
        } catch (e) {
          toast(e.message, "error");
        }
      }),
  );
}
function editAiDocument(d) {
  openModal(
    `<h3 id="modalTitle">${d ? "编辑知识资料" : "添加知识资料"}</h3><form id="aiDocumentForm"><label>导入文件<input id="aiDocFile" type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"></label><label>资料标题<input name="title" maxlength="150" value="${escapeHtml(d?.title || "")}" required></label><div class="form-grid"><label>适用地区<input name="region" maxlength="80" value="${escapeHtml(d?.region || "通用")}" required></label><label>发布日期<input name="publishedOn" type="date" value="${d?.published_on ? escapeHtml(String(d.published_on).slice(0, 10)) : ""}"></label><label>失效日期<input name="expiresOn" type="date" value="${d?.expires_on ? escapeHtml(String(d.expires_on).slice(0, 10)) : ""}"></label></div><label>资料正文<textarea name="content" rows="12" maxlength="60000" minlength="10" required>${escapeHtml(d?.content || "")}</textarea></label><p class="form-error" role="alert"></p><button class="primary" type="submit">保存并重新建立检索片段</button></form>`,
    true,
  );
  $("#aiDocFile").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const saveButton = $("#aiDocumentForm [type=submit]");
    saveButton.disabled = true;
    try {
      if (!/\.(txt|md|pdf)$/i.test(file.name) || file.size > 5 * 1024 * 1024)
        throw Error("请选择不超过 5 MB 的 TXT、Markdown 或 PDF");
      let content;
      if (/\.pdf$/i.test(file.name)) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        const result = await api("/api/ai/documents/extract", {
          method: "POST",
          body: JSON.stringify({ base64: btoa(binary) }),
        });
        content = result.content;
      } else content = await file.text();
      if (content.length > 60000) throw Error("正文超过 60000 字，请拆分文件");
      $("#aiDocumentForm [name=content]").value = content;
      if (!d)
        $("#aiDocumentForm [name=title]").value = file.name.replace(
          /\.[^.]+$/,
          "",
        );
      $("#aiDocumentForm .form-error").textContent = "";
    } catch (e) {
      $("#aiDocumentForm .form-error").textContent = e.message;
    } finally {
      saveButton.disabled = false;
    }
  };
  wireForm("aiDocumentForm", async (data) => {
    const result = await api("/api/ai/documents" + (d ? "/" + d.id : ""), {
      method: d ? "PUT" : "POST",
      body: JSON.stringify(Object.fromEntries(data)),
    });
    closeModal();
    toast(`资料已保存，共 ${result.chunks} 个片段`);
    await renderAiKnowledge();
  });
}
async function renderAiResults() {
  const [runs, results, summary] = await Promise.all([
    api("/api/ai/runs"),
    api("/api/ai/evaluations"),
    api("/api/ai/evaluation-summary"),
  ]);
  if (state.page !== "assistant" || aiView.tab !== "results") return;
  $("#aiTabContent").innerHTML =
    `<section class="panel ai-admin-panel"><div class="panel-head"><div><h3>可核对的运行记录</h3><p>记录模型、版本、工具调用、耗时与用量；失败也保留。</p></div><button id="aiRefreshResults" type="button" class="secondary">刷新</button></div><div class="ai-eval-summary">${summary.map((s) => `<div><b>${escapeHtml(s.model)}</b><strong>${s.passed} / ${s.total}</strong><span>最近一批测试通过 · 平均 ${s.avg_ms} ms</span></div>`).join("") || '<p class="muted">还没有评测记录</p>'}</div><h4>最近请求</h4><div class="table-wrap"><table><thead><tr><th>问题</th><th>模型</th><th>结果</th><th>耗时</th><th>用量</th></tr></thead><tbody>${runs.map((r) => `<tr><td><button class="text-btn" type="button" data-ai-run="${escapeHtml(r.id)}">${escapeHtml(r.question.slice(0, 55))}</button></td><td>${escapeHtml(r.model)}</td><td>${r.status === "completed" ? "完成" : escapeHtml(r.error_code || "失败")}</td><td>${(r.elapsed_ms / 1000).toFixed(1)} s</td><td>${Number(aiJson(r.usage_json).input_tokens) || 0} 入 / ${Number(aiJson(r.usage_json).output_tokens) || 0} 出</td></tr>`).join("")}</tbody></table></div><h4>评测案例</h4><div class="table-wrap"><table><thead><tr><th>案例</th><th>类别</th><th>模型或验证方式</th><th>结果</th></tr></thead><tbody>${results.map((r) => `<tr><td>${escapeHtml(r.case_key)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.model)}</td><td>${r.passed ? "通过" : "失败"}</td></tr>`).join("")}</tbody></table></div><p class="muted">程序回归与真实模型评测分别记录。通过数只代表这些案例，不代表所有问题都正确。</p></section>`;
  $("#aiRefreshResults").onclick = () => renderAiResults();
  $$("[data-ai-run]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          const r = await api("/api/ai/runs/" + b.dataset.aiRun);
          openModal(
            `<h3 id="modalTitle">请求详情</h3><p>${escapeHtml(r.question)}</p><p>模型 ${escapeHtml(r.model)} · 提示词 ${escapeHtml(r.prompt_version)}</p><pre class="ai-trace">${escapeHtml(JSON.stringify(aiJson(r.trace), null, 2))}</pre><p>${escapeHtml(r.answer || r.error_code || "")}</p>`,
            true,
          );
        } catch (e) {
          toast(e.message, "error");
        }
      }),
  );
}
