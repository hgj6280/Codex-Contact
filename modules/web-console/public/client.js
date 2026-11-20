import {bindPersonalityEditor} from './personality-editor.mjs';
import {bindTriggerEditor} from './trigger-editor.mjs';
import {bindFastModeToggle} from './fast-mode-editor.mjs';
import {bindImageModelEditor} from './image-model-editor.mjs';
import {bindCompanionEditor} from './companion-editor.mjs';
import {bindAutonomyEditor} from './autonomy-editor.mjs';
const HUB = location.protocol.startsWith("http") ? "" : "http://127.0.0.1:3789";
const personalityEditor = bindPersonalityEditor({root:document.querySelector('#personalityEditor'),
  api:(path, body) => api(path, body ? {method:'POST', body:JSON.stringify(body)} : {})});
const triggerEditor = bindTriggerEditor({root:document.querySelector('#triggerEditor'),
  api:(path, body) => api(path, body ? {method:'POST', body:JSON.stringify(body)} : {})});
const pollMs = 2200;
const fastModeEditor=bindFastModeToggle({root:document.querySelector('#fastModeEditor'),api:(path,body)=>api(path,body?{method:'POST',body:JSON.stringify(body)}:{})});
const imageModelEditor=bindImageModelEditor({root:document.querySelector('#imageModelEditor'),api:(path,body)=>api(path,body?{method:'POST',body:JSON.stringify(body)}:{})});
const companionEditor=bindCompanionEditor({root:document.querySelector('#companionEditor'),selected:()=>selectedChat,api:(path,body)=>api(path,body?{method:'POST',body:JSON.stringify(body)}:{})});
const autonomyEditor=bindAutonomyEditor({root:document.querySelector('#autonomyEditor'),selected:()=>selectedChat,api:(path,body)=>api(path,body?{method:'POST',body:JSON.stringify(body)}:{})});
let activeDashboardView = 'overview';
const themeToggle = document.querySelector('#themeToggle');
function renderTheme() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeToggle.textContent = dark ? '☀' : '☾';
  themeToggle.setAttribute('aria-pressed', String(dark));
  themeToggle.title = dark ? '切换日间模式' : '切换夜间模式';
  themeToggle.setAttribute('aria-label', themeToggle.title);
}
themeToggle.addEventListener('click', () => {
  document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('qq-console-theme', document.documentElement.dataset.theme); } catch {}
  renderTheme();
});
renderTheme();

const dashboardTabs = [...document.querySelectorAll('[data-dashboard-tab]')];
for (const tab of dashboardTabs) {
  tab.addEventListener('click', () => {
    const view = tab.dataset.dashboardTab;
    activeDashboardView = view;
    for (const panel of document.querySelectorAll('[data-dashboard-view]')) {
      panel.hidden = panel.dataset.dashboardView !== view;
    }
    for (const button of dashboardTabs) {
      button.setAttribute('aria-pressed', String(button === tab));
    }
    if (view === 'chat') refreshChat();
    if (view === 'models') {personalityEditor.load();triggerEditor.load({force:true});fastModeEditor.load();imageModelEditor.load();companionEditor.load();autonomyEditor.load();}
  });
}

const els = {
  hubStatus: document.querySelector("#hubStatus"),
  refresh: document.querySelector("#refresh"),
  openHub: document.querySelector("#openHub"),
  qqToggle: document.querySelector("#qqToggle"),
  imessageToggle: document.querySelector("#imessageToggle"),
  refreshMaintenance: document.querySelector("#refreshMaintenance"),
  refreshMemory: document.querySelector("#refreshMemory"),
  healthGrid: document.querySelector("#healthGrid"),
  lastUpdated: document.querySelector("#lastUpdated"),
  groupCount: document.querySelector("#groupCount"),
  groupList: document.querySelector("#groupList"),
  groupInput: document.querySelector("#groupInput"),
  addGroupForm: document.querySelector("#addGroupForm"),
  handleCount: document.querySelector("#handleCount"),
  handleList: document.querySelector("#handleList"),
  handleInput: document.querySelector("#handleInput"),
  addHandleForm: document.querySelector("#addHandleForm"),
  replyHandleInput: document.querySelector("#replyHandleInput"),
  replyHandleForm: document.querySelector("#replyHandleForm"),
  qqEvents: document.querySelector("#qqEvents"),
  imessageEvents: document.querySelector("#imessageEvents"),
  memoryView: document.querySelector("#memoryView"),
  memoryTabs: Array.from(document.querySelectorAll("[data-memory-tab]"))
};

let lastState = null;
let lastMemory = null;
let activeMemoryTab = "unified";
const openMemoryGroups = new Set();
let busy = false;
for (const [id, enabled] of [['roleplayStart', true], ['roleplayStop', false]]) {
  document.querySelector(`#${id}`).addEventListener('click', async () => {
    const status = document.querySelector('#roleplayStatus');
    try {
      const r = await api('/api/qq/roleplay', { method: 'POST', body: JSON.stringify({enabled}) });
      status.textContent = r.enabled ? `跑团已开启，剩余 ${r.remaining} 条联动回复` : '跑团联动已停止（正在发送的消息可能仍会送达）';
    } catch (error) { status.textContent = `设置失败：${error.message}`; }
  });
}
let qqModelDirty = false;
const qqModelSelect = document.querySelector('#qqModelSelect');
qqModelSelect.addEventListener('change', () => { qqModelDirty = true; });
document.querySelector('#qqModelForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.querySelector('#qqModelSave');
  const status = document.querySelector('#qqModelStatus');
  button.disabled = true;
  qqModelSelect.disabled = true;
  status.textContent = '正在保存…';
  try {
    const result = await api('/api/qq/model', { method: 'POST', body: JSON.stringify({ model: qqModelSelect.value }) });
    qqModelDirty = false;
    status.textContent = `已保存 ${result.model}，从下一条 QQ 请求生效。`;
    await refreshAll();
  } catch (error) {
    status.textContent = `保存失败：${error.message}`;
  } finally {
    button.disabled = false;
    qqModelSelect.disabled = false;
  }
});

async function api(path, options = {}) {
  const response = await fetch(`${HUB}${path}`, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function refreshAll() {
  if (busy) return;
  busy = true;
  try {
    const [state, maintenance, memory, validationReports] = await Promise.all([
      api("/api/state"),
      api("/api/maintenance"),
      api("/api/memory"),
      api("/api/qq/validation-reports").catch(() => ({ reports: [] }))
    ]);
    setHubStatus(true);
    lastState = state;
    lastMemory = memory;
    try {
      renderState(state);
      renderMaintenance(maintenance);
      renderMemory(memory);
      renderValidationReports(validationReports.reports || []);
      if (activeDashboardView === 'chat') await refreshChat();
    } catch (renderError) {
      console.error(renderError);
    }
  } catch (error) {
    setHubStatus(false, error.message);
  } finally {
    busy = false;
  }
}

function renderValidationReports(reports) {
  const host = document.querySelector('#qqValidationReports');
  if (!host) return;
  if (!reports.length) { host.textContent = '还没有验收报告。'; return; }
  const labels = { text:'文字', identity:'角色外观', anatomy:'手指/肢体', pose:'动作姿势', clothing:'衣服', props:'道具', composition:'构图' };
  host.replaceChildren(...reports.slice(0, 8).map(report => {
    const row = document.createElement('p');
    const link = document.createElement('a');
    link.href = report.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = `${new Date(report.createdAt).toLocaleString('zh-CN')} · ${report.status} · ${String(report.request || '').slice(0, 45)}`;
    row.append(link);
    const failures = [...new Set((report.failures || []).map(item => labels[item.category] || item.category))];
    if (failures.length) row.append(document.createTextNode(` · 问题：${failures.join('、')}`));
    host.append(row); return row;
  }));
}

function setHubStatus(ok, message = "") {
  els.hubStatus.textContent = ok ? "Hub 在线" : "Hub 离线";
  els.hubStatus.title = message;
  els.hubStatus.classList.toggle("warn", !ok);
  els.hubStatus.classList.toggle("bad", !ok);
}

function renderState(state) {
  renderQqUsage(state.qq?.usage);
  const qqReplyModel = ['local-qwen35-4b','gemini-3.8flash'].includes(state.ai.qqReplyProvider) ? state.ai.qqReplyProvider : state.ai.model;
  document.querySelector('#qqModelCurrent').textContent = `当前：${qqReplyModel} · 思考强度：${state.ai.reasoningEffort === 'low' ? '轻度' : state.ai.reasoningEffort}`;
  if (!qqModelDirty) qqModelSelect.value = qqReplyModel;
  els.qqToggle.checked = Boolean(state.channels?.qq);
  els.imessageToggle.checked = Boolean(state.channels?.imessage);
  renderGroups(state.qq?.allowedGroups || []);
  renderHandles(state.imessage?.trustedHandles || []);
  els.replyHandleInput.value = state.imessage?.replyHandle || "";
  renderQqEvents(state.qq?.events || []);
  renderIMessageEvents(state.imessage?.events || []);
}

function renderQqUsage(usage) {
  const since = document.querySelector('#qqUsageSince');
  const rows = document.querySelector('#qqUsageRows');
  const status = document.querySelector('#qqUsageStatus');
  if (!usage) { since.textContent = '用量统计尚未启用'; rows.replaceChildren(); return; }
  since.textContent = `开始记录：${new Date(usage.startedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · 今日 ${usage.todayDate}`;
  rows.replaceChildren(...[['今日', usage.today], ['累计', usage.total]].map(([label, counts]) => {
    const row = document.createElement('tr');
    const amount = counts.estimatedCny;
    const cost = amount == null || (counts.unpricedTokens && counts.unpricedTokens === counts.totalTokens)
      ? '待计价' : `${counts.unpricedTokens ? '部分 ' : ''}${amount > 0 && amount < 0.0001 ? '<¥0.0001' : '¥' + amount.toFixed(4)}`;
    [label, ...['totalTokens', 'inputTokens', 'outputTokens', 'cachedInputTokens'].map(k => counts[k].toLocaleString('en-US')), cost].forEach((value, index) => {
      const cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) cell.scope = 'row';
      cell.textContent = value;
      row.append(cell);
    });
    return row;
  }));
  const totals = usage.total;
  document.querySelector('#qqUsagePricing').textContent = usage.pricing
    ? `价格核对：${usage.pricing.checkedAt} · 标准短上下文 API 等价估算。${usage.pricing.exchangeRate ? `固定参考汇率（${usage.pricing.exchangeRate.date}）：1 美元 = ${usage.pricing.exchangeRate.usdToCny} 元人民币，非实时汇率。` : ''}${usage.pricing.exclusions}。未知模型不套用其他模型价格。` : '';
  status.textContent = [
    `已收到用量 ${totals.recordedCalls} 次 / 发起调用 ${totals.calls} 次`,
    totals.pendingCalls ? `进行中 ${totals.pendingCalls} 次，尚未返回的用量暂未计入` : '',
    totals.incompleteCalls ? `${totals.incompleteCalls} 次失败、中断或缺少完整用量，合计可能偏低` : '',
    totals.unpricedTokens ? `${totals.unpricedTokens.toLocaleString('en-US')} token 暂无可靠单价，未计入费用` : '',
    usage.lastError || ''
  ].filter(Boolean).join(' · ');
}

function renderMaintenance(health) {
  setHubStatus(true);
  els.lastUpdated.textContent = `上次同步 ${new Date().toLocaleTimeString()}`;
  const cards = [
    {
      title: "QQ 桥接 / OneBot",
      ok: health.oneBot?.ok,
      lines: [
        health.oneBot?.ok ? "API 在线" : "API 离线",
        health.oneBot?.nickname ? `账号 ${health.oneBot.nickname}` : null,
        health.oneBot?.selfId ? `QQ ${health.oneBot.selfId}` : null,
        health.oneBot?.lastError
      ]
    },
    {
      title: "Codex CLI",
      ok: health.codex?.pathExists && health.codex?.lastOk !== false,
      lines: [
        health.codex?.pathExists ? "路径存在" : "路径缺失",
        health.codex?.lastRunAt ? `运行 ${formatTime(health.codex.lastRunAt)}` : "还未运行",
        health.codex?.lastDurationMs != null ? `${health.codex.lastDurationMs} ms` : null,
        health.codex?.lastError
      ],
      detailHtml: renderCodexQuotaBlock(health.codex?.quota)
    },
    {
      title: "iMessage",
      ok: health.channels?.imessage && health.imessage?.status !== "error",
      lines: [
        health.channels?.imessage ? "开关开启" : "开关关闭",
        `状态 ${health.imessage?.status || "idle"}`,
        `可信 ${health.imessage?.trustedHandles ?? 0} 个`,
        health.imessage?.lastError
      ]
    },
    {
      title: "远程执行模式",
      ok: Boolean(health.remoteExecution?.enabled),
      lines: [
        health.remoteExecution?.enabled ? "当前开启" : "当前关闭",
        `模型 ${health.remoteExecution?.model || "未知"}`,
        `智能 ${health.remoteExecution?.reasoningEffort || "未知"}`,
        `记忆 ${health.remoteExecution?.memoryCount ?? 0} 条`,
        health.remoteExecution?.busy ? "Codex 正在运行" : null
      ]
    },
    {
      title: "QQ",
      ok: health.channels?.qq,
      lines: [
        health.channels?.qq ? "开关开启" : "开关关闭",
        `白名单 ${health.qq?.allowedGroups ?? 0} 个`,
        `记忆 ${health.qq?.memoryGroups ?? 0} 个群`,
        `事件 ${health.qq?.recentEvents ?? 0} 条`
      ]
    },
    {
      title: "联网查询",
      ok: health.webLookup?.enabled && health.webLookup?.lastOk !== false,
      lines: [
        health.webLookup?.enabled ? "开关开启" : "开关关闭",
        health.webLookup?.lastQuery ? `查询 ${health.webLookup.lastQuery}` : "还未查询",
        health.webLookup?.lastDurationMs != null ? `${health.webLookup.lastDurationMs} ms` : null,
        health.webLookup?.lastError
      ]
    }
  ];

  els.healthGrid.innerHTML = cards.map((card) => `
    <article class="health-card ${card.ok ? "ok" : "bad"}">
      <div class="title">
        <strong>${escapeHtml(card.title)}</strong>
        <span>${card.ok ? "正常" : "注意"}</span>
      </div>
      ${card.lines.filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
      ${card.detailHtml || ""}
    </article>
  `).join("");
}

function renderCodexQuotaBlock(quota) {
  if (!quota?.available) return "";
  const rows = [
    renderQuotaRow("5 小时", quota.primary),
    renderQuotaRow("7 天", quota.secondary)
  ].filter(Boolean).join("");
  const summary = quota.totalTokens != null && quota.modelContextWindow != null
    ? `<p class="quota-summary">已使用 ${escapeHtml(formatTokenNumber(quota.totalTokens))} / 共 ${escapeHtml(formatContextWindow(quota.modelContextWindow))}</p>`
    : "";
  const updated = quota.updatedAt
    ? `<p class="quota-updated">记录 ${escapeHtml(formatTime(quota.updatedAt))}</p>`
    : "";
  return rows || summary ? `<div class="quota-block">${summary}${rows}${updated}</div>` : "";
}

function renderQuotaRow(label, window) {
  if (!window) return "";
  return `
    <div class="quota-row">
      <div class="quota-meta">
        <strong>${escapeHtml(label)}</strong>
        <span>剩余 ${escapeHtml(formatPercent(window.remainingPercent))} · 重置 ${escapeHtml(formatResetTime(window.resetsAt))}</span>
      </div>
      <div class="quota-track" aria-hidden="true">
        <span class="quota-fill" style="width: ${escapeHtml(formatPercent(window.remainingPercent))}"></span>
      </div>
    </div>
  `;
}

function renderMemory(memory) {
  if (!els.memoryView) return;
  rememberOpenMemoryGroups();
  els.memoryTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.memoryTab === activeMemoryTab);
  });

  if (activeMemoryTab === "unified") {
    els.memoryView.innerHTML = renderUnifiedMemory(memory?.unified || {});
    return;
  }

  if (activeMemoryTab === "remoteExecution") {
    const entries = memory?.remoteExecution?.entries || [];
    els.memoryView.innerHTML = `
      <div class="memory-toolbar">
        <strong>远程执行模式记忆 · ${entries.length} 条</strong>
        <button class="button danger" data-clear-memory="remoteExecution">清空</button>
      </div>
      ${renderMemoryEntries(entries, "远程执行模式还没有记忆。")}
    `;
    return;
  }

  if (activeMemoryTab === "qq") {
    const lightweight = memory?.qq?.lightweight || [];
    const recent = memory?.qq?.recent || [];
    const groups = [...lightweight, ...recent];
    els.memoryView.innerHTML = groups.length
      ? groups.map((group) => `
        <details class="memory-group" data-memory-key="qq:${escapeHtml(group.id)}" ${openMemoryGroups.has(`qq:${group.id}`) ? "open" : ""}>
          <summary>
            <span>${escapeHtml(group.title)}</span>
            <em>${group.count} 条</em>
            <button class="small-danger" data-clear-memory="qq" data-memory-id="${escapeHtml(group.id)}" type="button">清空</button>
          </summary>
          ${renderMemoryEntries(group.entries, "这个群还没有可显示的记忆。")}
        </details>
      `).join("")
      : `<p class="empty">QQ 还没有记忆。</p>`;
    return;
  }

  const handles = memory?.imessage || [];
  els.memoryView.innerHTML = handles.length
    ? handles.map((handle) => `
      <details class="memory-group" data-memory-key="imessage:${escapeHtml(handle.id)}" ${openMemoryGroups.has(`imessage:${handle.id}`) ? "open" : ""}>
        <summary>
          <span>${escapeHtml(handle.title)}</span>
          <em>${handle.count} 条</em>
          <button class="small-danger" data-clear-memory="imessage" data-memory-id="${escapeHtml(handle.id)}" type="button">清空</button>
        </summary>
        ${renderMemoryEntries(handle.entries, "这个联系人还没有可显示的记忆。")}
      </details>
    `).join("")
    : `<p class="empty">iMessage 还没有记忆。</p>`;
}

function renderUnifiedMemory(unified) {
  const settings = unified.settings || {};
  const counts = unified.counts || {};
  const entries = unified.entries || [];
  const stateParts = [
    unified.currentState?.timeContext,
    unified.currentState?.sleepState,
    unified.currentState?.recentMeal,
    unified.currentState?.bodyState,
    unified.currentState?.mood
  ].filter(Boolean);
  return `
    <div class="memory-toolbar">
      <strong>统一记忆 · ${entries.length} 条可读摘要</strong>
      <span class="muted-text">${escapeHtml(unified.updatedAt ? `更新 ${formatTime(unified.updatedAt)}` : "暂无更新")}</span>
    </div>
    <div class="unified-switches">
      ${renderUnifiedSwitch("autoWriteOnSkillRecall", "电脑端 skill 调用后写入", settings.autoWriteOnSkillRecall)}
      ${renderUnifiedSwitch("autoWriteOnIMessageRecall", "iMessage 跨端回看后写入", settings.autoWriteOnIMessageRecall)}
      ${renderUnifiedSwitch("manualHandoffCommand", "允许 /交接 手动写入", settings.manualHandoffCommand !== false)}
    </div>
    <div class="memory-summary-grid">
      <span>交接 ${escapeHtml(counts.handoffHistory || 0)}</span>
      <span>点子 ${escapeHtml(counts.ideas || 0)}</span>
      <span>项目 ${escapeHtml(counts.projectNotes || 0)}</span>
      <span>待办 ${escapeHtml(counts.openLoops || 0)}</span>
      <span>日常 ${escapeHtml(counts.dailyTimeline || 0)}</span>
    </div>
    ${stateParts.length ? `<p class="memory-state">近期状态：${escapeHtml(stateParts.join("；"))}</p>` : ""}
    ${unified.latestHandoff?.summary ? `
      <article class="memory-entry">
        <div class="meta">最近交接</div>
        <p>${escapeHtml(unified.latestHandoff.summary)}</p>
      </article>
    ` : ""}
    ${entries.length ? `<div class="memory-entries">${entries.map(renderUnifiedEntry).join("")}</div>` : `<p class="empty">统一记忆还没有可显示条目。</p>`}
  `;
}

function renderUnifiedSwitch(key, label, checked) {
  return `
    <label class="switch-row">
      <span>${escapeHtml(label)}</span>
      <input type="checkbox" data-unified-setting="${escapeHtml(key)}" ${checked ? "checked" : ""} />
    </label>
  `;
}

function renderUnifiedEntry(entry) {
  const title = [formatUnifiedType(entry.type), entry.topic].filter(Boolean).join(" · ");
  const meta = [title, entry.updatedAt ? formatTime(entry.updatedAt) : null].filter(Boolean).join(" · ");
  return `
    <article class="memory-entry">
      <div class="meta">${escapeHtml(meta || "统一记忆")}</div>
      <p>${escapeHtml(entry.summary || "")}</p>
    </article>
  `;
}

function formatUnifiedType(type) {
  return {
    handoff: "交接",
    idea: "点子",
    projectNote: "项目",
    preference: "偏好",
    openLoop: "待办",
    dailyState: "日常"
  }[type] || type || "";
}

function rememberOpenMemoryGroups() {
  els.memoryView?.querySelectorAll?.(".memory-group[data-memory-key]").forEach((group) => {
    const key = group.dataset.memoryKey;
    if (!key) return;
    if (group.open) openMemoryGroups.add(key);
    else openMemoryGroups.delete(key);
  });
}

function renderMemoryEntries(entries, emptyText) {
  return entries?.length
    ? `<div class="memory-entries">${entries.slice().reverse().map((entry) => `
      <article class="memory-entry">
        <div class="meta">${escapeHtml(formatMemoryRole(entry.role))}${entry.at ? ` · ${escapeHtml(formatTime(entry.at))}` : ""}</div>
        <p>${escapeHtml(entry.text)}</p>
      </article>
    `).join("")}</div>`
    : `<p class="empty">${escapeHtml(emptyText)}</p>`;
}

function formatMemoryRole(role) {
  const value = String(role || "");
  if (value === "assistant") return "assistant";
  if (value === "user") return "owner";
  return value || "消息";
}

function renderGroups(groups) {
  els.groupCount.textContent = `${groups.length} 个`;
  els.groupList.innerHTML = groups.length
    ? groups.map((groupId) => `
      <div class="list-item">
        <code>${escapeHtml(groupId)}</code>
        <button class="remove" data-remove-group="${escapeHtml(groupId)}" title="移除">×</button>
      </div>
    `).join("")
    : `<p class="empty">还没有群白名单。</p>`;
}

function renderHandles(handles) {
  els.handleCount.textContent = `${handles.length} 个`;
  els.handleList.innerHTML = handles.length
    ? handles.map((handle) => `
      <div class="list-item">
        <code>${escapeHtml(handle)}</code>
        <button class="remove" data-remove-handle="${escapeHtml(handle)}" title="移除">×</button>
      </div>
    `).join("")
    : `<p class="empty">还没有可信联系人。</p>`;
}

function renderQqEvents(events) {
  els.qqEvents.innerHTML = events.length
    ? events.slice(0, 8).map((record) => {
      const ok = Boolean(record.decision?.ok);
      const sender = record.event?.senderLabel || record.event?.senderName || "群友";
      const reply = record.reply ? `<p>回复：${escapeHtml(record.reply)}</p>` : "";
      return `
        <article class="event ${ok ? "ok" : "skip"}">
          <div class="meta">${formatTime(record.receivedAt)} · ${ok ? "回复" : "忽略"} · ${escapeHtml(record.decision?.reason || "")}</div>
          <p>${escapeHtml(sender)}：${escapeHtml(record.event?.text || "")}</p>
          ${reply}
        </article>
      `;
    }).join("")
    : `<p class="empty">暂无 QQ 事件。</p>`;
}

function renderIMessageEvents(events) {
  els.imessageEvents.innerHTML = events.length
    ? events.slice(0, 8).map((record) => {
      const ok = record.result?.ok || record.send?.ok;
      const attachments = record.event?.attachments?.length
        ? `<p>附件：${record.event.attachments.map((item) => escapeHtml(item.transferName || item.filename || "附件")).join("、")}</p>`
        : "";
      const reply = record.reply ? `<p>回复：${escapeHtml(record.reply)}</p>` : "";
      return `
        <article class="event ${ok ? "ok" : "skip"}">
          <div class="meta">${formatTime(record.receivedAt)} · ${record.trusted ? "可信" : "未授权"} · ${escapeHtml(record.result?.summary || "")}</div>
          <p>${escapeHtml(record.event?.handle || "未知")}：${escapeHtml(record.event?.text || "")}</p>
          ${attachments}
          ${reply}
        </article>
      `;
    }).join("")
    : `<p class="empty">暂无 iMessage 事件。</p>`;
}

async function setChannel(channel, enabled) {
  await api("/api/channel", {
    method: "POST",
    body: JSON.stringify({ channel, enabled })
  });
  await refreshAll();
}

async function saveGroups(groups) {
  await api("/api/qq/groups", {
    method: "POST",
    body: JSON.stringify({ allowedGroups: groups })
  });
  await refreshAll();
}

async function saveHandles(handles) {
  await api("/api/imessage/trusted-handles", {
    method: "POST",
    body: JSON.stringify({ trustedHandles: handles })
  });
  await refreshAll();
}

async function clearMemory(scope, id = "") {
  if(!window.confirm(`清除${id?'这个会话':'此范围全部'}的${scope==='qq'?'短期、长期':''} AI 记忆？原始聊天记录和素材不删除。`))return;
  await api("/api/memory/clear", {
    method: "POST",
    body: JSON.stringify({ scope, id })
  });
  await refreshAll();
}

async function saveUnifiedMemorySettings(nextSettings) {
  await api("/api/unified-memory/settings", {
    method: "POST",
    body: JSON.stringify(nextSettings)
  });
  await refreshAll();
}

function formatTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString();
}

function formatResetTime(epochSeconds) {
  const date = new Date(Number(epochSeconds) * 1000);
  if (Number.isNaN(date.getTime())) return "--";
  const now = new Date();
  const sameDate = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return sameDate
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0%";
  return `${Math.max(0, Math.min(100, Math.round(numeric)))}%`;
}

function formatTokenNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  return Math.round(numeric).toLocaleString("en-US");
}

function formatContextWindow(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "--";
  if (numeric >= 1000) return `${Math.round(numeric / 1000)}K`;
  return `${Math.round(numeric)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

els.refresh.addEventListener("click", refreshAll);
els.refreshMaintenance.addEventListener("click", refreshAll);
els.refreshMemory.addEventListener("click", refreshAll);
els.openHub.addEventListener("click", () => {
  window.webkit?.messageHandlers?.codexRemoteContactNative?.postMessage({ action: "openHub" });
});

els.qqToggle.addEventListener("change", () => setChannel("qq", els.qqToggle.checked).catch(refreshAll));
els.imessageToggle.addEventListener("change", () => setChannel("imessage", els.imessageToggle.checked).catch(refreshAll));

els.addGroupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = els.groupInput.value.trim();
  if (!value || !lastState) return;
  const groups = Array.from(new Set([...(lastState.qq?.allowedGroups || []), value]));
  els.groupInput.value = "";
  await saveGroups(groups);
});

els.groupList.addEventListener("click", async (event) => {
  const groupId = event.target?.dataset?.removeGroup;
  if (!groupId || !lastState) return;
  await saveGroups((lastState.qq?.allowedGroups || []).filter((item) => item !== groupId));
});

els.addHandleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = els.handleInput.value.trim();
  if (!value || !lastState) return;
  const handles = Array.from(new Set([...(lastState.imessage?.trustedHandles || []), value]));
  els.handleInput.value = "";
  await saveHandles(handles);
});

els.handleList.addEventListener("click", async (event) => {
  const handle = event.target?.dataset?.removeHandle;
  if (!handle || !lastState) return;
  await saveHandles((lastState.imessage?.trustedHandles || []).filter((item) => item !== handle));
});

els.replyHandleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/imessage/reply-handle", {
    method: "POST",
    body: JSON.stringify({ replyHandle: els.replyHandleInput.value.trim() })
  });
  await refreshAll();
});

els.memoryTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    activeMemoryTab = tab.dataset.memoryTab;
    renderMemory(lastMemory);
  });
});

els.memoryView.addEventListener("click", async (event) => {
  const button = event.target?.closest?.("[data-clear-memory]");
  if (!button) return;
  event.preventDefault();
  const scope = button.dataset.clearMemory;
  const id = button.dataset.memoryId || "";
  await clearMemory(scope, id);
});

els.memoryView.addEventListener("change", async (event) => {
  const input = event.target?.closest?.("[data-unified-setting]");
  if (!input || !lastMemory?.unified) return;
  const key = input.dataset.unifiedSetting;
  const settings = {
    autoWriteOnSkillRecall: Boolean(lastMemory.unified.settings?.autoWriteOnSkillRecall),
    autoWriteOnIMessageRecall: lastMemory.unified.settings?.autoWriteOnIMessageRecall !== false,
    manualHandoffCommand: lastMemory.unified.settings?.manualHandoffCommand !== false
  };
  settings[key] = input.checked;
  await saveUnifiedMemorySettings(settings);
});

refreshAll();
setInterval(refreshAll, pollMs);

const chatEls = Object.fromEntries(['chatGroups','chatSearch','chatTitle','chatSubtitle','chatMessages','chatInput','chatSend',
  'chatSendForm','chatSendStatus','chatLength','chatGroupCount','chatAutoStatus','chatSendHint'].map(id => [id, document.getElementById(id)]));
let chatGroups = [], chatBusy = false, chatSending = false, chatVersion = '', chatRequestId = null;
let selectedChat = ''; try { selectedChat = localStorage.getItem('qq-console-chat') || ''; } catch {}
const chatDrafts = new Map();
// Older compact history stored CQ codes rather than typed message segments.
function chatDisplayText(text) {
  return String(text || '').replace(/\[CQ:(\w+)(?:,[^\]]*)?(?:\]|$)/g, (raw, type) => {
    if (type === 'at') return `@${raw.match(/qq=(\d+|all)/)?.[1] === 'all' ? '全体成员' : raw.match(/qq=(\d+)/)?.[1] || '群友'} `;
    return ({image:'[图片]',forward:'[转发消息]',reply:'[引用消息]',face:'[表情]',record:'[语音]',video:'[视频]',file:'[文件]',json:'[分享卡片]',xml:'[分享卡片]'})[type] || '[附件]';
  });
}
function renderChatGroups() {
  const query = chatEls.chatSearch.value.trim().toLowerCase();
  chatEls.chatGroupCount.textContent = chatGroups.length;
  const visible = chatGroups.filter(g => `${g.name} ${g.id}`.toLowerCase().includes(query));
  chatEls.chatGroups.replaceChildren(...visible.map(group => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'chat-group';
    button.classList.toggle('active', group.id === selectedChat); button.setAttribute('aria-pressed', String(group.id === selectedChat));
    const avatar = document.createElement('span'); avatar.className = 'chat-group-avatar'; avatar.textContent = group.name.slice(0,1);
    const info = document.createElement('span'); info.className = 'chat-group-info';
    const name = document.createElement('strong'); name.textContent = group.name;
    const id = document.createElement('small'); id.textContent = group.id;
    const preview = document.createElement('span'); preview.className = 'chat-group-preview'; preview.textContent = chatDisplayText(group.preview) || '暂无消息';
    info.append(name, id, preview); button.append(avatar, info);
    button.addEventListener('click', () => {
      if (selectedChat === group.id) return;
      chatDrafts.set(selectedChat, chatEls.chatInput.value);
      selectedChat = group.id; chatVersion = ''; chatRequestId = null;
      try { localStorage.setItem('qq-console-chat', selectedChat); } catch {}
      chatEls.chatInput.value = chatDrafts.get(selectedChat) || ''; chatEls.chatSendStatus.textContent = '';
      chatEls.chatMessages.replaceChildren(); updateChatHeading(); updateChatComposer(); renderChatGroups(); refreshChat();
    }); return button;
  }));
  if (!visible.length) {
    const p = document.createElement('p'); p.className = 'chat-empty'; p.textContent = query ? '没有匹配的群聊' : '请先添加群白名单'; chatEls.chatGroups.append(p);
  }
}
function updateChatHeading() {
  const group = chatGroups.find(g => g.id === selectedChat);
  chatEls.chatTitle.textContent = group?.name || '选择一个群聊';
  chatEls.chatSubtitle.textContent = group ? `${group.id} · 以狐宫静的 QQ 账号发送` : '先在左侧选择群聊';
}
function updateChatComposer() {
  chatEls.chatInput.disabled = !selectedChat;
  chatEls.chatSend.disabled = !selectedChat || !chatEls.chatInput.value.trim() || chatSending;
  chatEls.chatSend.textContent = chatSending ? '发送中…' : '发送';
  chatEls.chatLength.textContent = `${chatEls.chatInput.value.length} / 2000`;
}
function renderChatMessages(messages, groupId) {
  if (groupId !== selectedChat) return;
  const version = JSON.stringify(messages.map(m => [m.id,m.status,m.text,m.images]));
  if (chatVersion === version) return;
  const host = chatEls.chatMessages;
  const nearBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 100;
  const first = !chatVersion; const oldTop = host.scrollTop; chatVersion = version;
  let lastDay = '';
  const children = [];
  for (const message of messages) {
    const date = new Date(message.at); const day = date.toLocaleDateString('zh-CN');
    if (day !== lastDay) { const label = document.createElement('div'); label.className = 'chat-day'; label.textContent = day; children.push(label); lastDay = day; }
    const row = document.createElement('article'); row.className = `chat-message ${message.direction === 'outgoing' ? 'outgoing' : 'incoming'}`;
    const meta = document.createElement('div'); meta.className = 'chat-message-meta';
    meta.textContent = `${message.senderName || '群友'} · ${date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}${message.source === 'manual' ? ' · 手动发送' : ''}`;
    const bubble = document.createElement('div'); bubble.className = 'chat-bubble';
    if (message.text) { const text = document.createElement('div'); text.className = 'chat-text'; text.textContent = message.source === 'history' ? chatDisplayText(message.text) : message.text; bubble.append(text); }
    for (const url of message.images || []) {
      const link = document.createElement('a'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      const img = document.createElement('img'); img.src = url; img.alt = '聊天图片'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.addEventListener('load', () => { if (nearBottom || first) host.scrollTop = host.scrollHeight; });
      img.addEventListener('error', () => { img.remove(); link.removeAttribute('href'); link.textContent = '图片链接已失效'; });
      link.append(img); bubble.append(link);
    }
    row.append(meta, bubble);
    if (message.direction === 'outgoing') {
      const status = document.createElement('span'); status.className = 'chat-delivery';
      status.textContent = ({sending:'发送中',sent:'已发送',failed:'发送失败',unknown:'发送结果未确认'})[message.status] || '';
      if (['failed','unknown'].includes(message.status)) { status.classList.add('error'); status.title = message.error || ''; }
      row.append(status);
    }
    children.push(row);
  }
  if (!children.length) { const p = document.createElement('p'); p.className = 'chat-empty'; p.textContent = '还没有这个群的消息，新消息会显示在这里'; children.push(p); }
  host.replaceChildren(...children); host.scrollTop = first || nearBottom ? host.scrollHeight : oldTop;
}
async function refreshChat() {
  if (chatBusy || activeDashboardView !== 'chat') return;
  chatBusy = true;
  try {
    const list = await api('/api/qq/chats'); chatGroups = list.groups;
    if (!chatGroups.some(g => g.id === selectedChat)) {
      selectedChat = chatGroups[0]?.id || ''; chatVersion = ''; chatRequestId = null;
      chatEls.chatInput.value = chatDrafts.get(selectedChat) || '';
    }
    chatEls.chatAutoStatus.textContent = list.aiEnabled ? 'AI 回复开启' : 'AI 回复关闭';
    chatEls.chatAutoStatus.classList.toggle('warn', !list.aiEnabled);
    renderChatGroups(); updateChatHeading(); updateChatComposer();
    if (selectedChat) { const id = selectedChat; const result = await api(`/api/qq/chat/${id}`); renderChatMessages(result.messages, id); }
  } catch (error) { chatEls.chatSendStatus.textContent = `聊天同步失败：${error.message}`; }
  finally { chatBusy = false; }
}
chatEls.chatSearch.addEventListener('input', renderChatGroups);
chatEls.chatInput.addEventListener('input', () => { chatRequestId = null; updateChatComposer(); });
chatEls.chatInput.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (!chatEls.chatSend.disabled) chatEls.chatSendForm.requestSubmit(); }
});
chatEls.chatSendForm.addEventListener('submit', async event => {
  event.preventDefault(); if (chatSending || !selectedChat || !chatEls.chatInput.value.trim()) return;
  const groupId = selectedChat, text = chatEls.chatInput.value;
  chatRequestId ||= crypto.randomUUID(); const requestId = chatRequestId;
  chatSending = true; updateChatComposer(); chatEls.chatSendStatus.textContent = '正在发送…';
  try {
    const result = await api('/api/qq/chat/send', { method:'POST', body:JSON.stringify({groupId,text,requestId}) });
    if (result.ok) {
      if (chatDrafts.get(groupId) === text) chatDrafts.delete(groupId);
      if (selectedChat === groupId && chatEls.chatInput.value === text) { chatEls.chatInput.value = ''; chatRequestId = null; }
      if (selectedChat === groupId) chatEls.chatSendStatus.textContent = '已发送';
    } else if (selectedChat === groupId) chatEls.chatSendStatus.textContent = result.error || '发送结果未确认，请先检查 QQ';
  } catch (error) { if (selectedChat === groupId) chatEls.chatSendStatus.textContent = `发送未确认：${error.message}。请先检查 QQ，勿重复发送。`; }
  finally { chatSending = false; updateChatComposer(); await refreshChat(); }
});
