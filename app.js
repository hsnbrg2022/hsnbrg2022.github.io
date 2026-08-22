import { STATUS, calculateBookAccountRatio, deriveDashboard, derivePositioningSignal, formatMoney } from "./model.js?v=20260822-3";
import { refreshPublicDashboard } from "./public-refresh.js?v=20260822-1";

const SECTION_META = {
  capital: { number: "01", title: "资金面", subtitle: "资本是否在入场", accent: "mint" },
  macro: { number: "02", title: "宏观", subtitle: "流动性环境是否友好", accent: "gold" },
  onchain: { number: "03", title: "链上估值", subtitle: "周期位置", accent: "blue" },
  positioning: { number: "04", title: "仓位情绪", subtitle: "衍生品结构", accent: "violet" }
};

let dashboard;
let publishedPositioningCard;
let publishedDataMode;
const POSITIONING_STORAGE_KEY = "crypto-signal-tracker:positioning-v1";
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .format(new Date(`${dateString}T00:00:00+08:00`));
}

function renderCard(card) {
  const status = STATUS[card.status];
  const fetchedAt = card.marketFetchedAt ? ` title="行情时间 ${escapeHtml(card.marketFetchedAt)}"` : "";
  const source = card.source?.url
    ? `<a href="${escapeHtml(card.source.url)}" target="_blank" rel="noreferrer"${fetchedAt}>${escapeHtml(card.source.label)} ↗</a>`
    : `<span>${escapeHtml(card.source?.label || "未填写")}</span>`;
  const refreshLabel = card.refresh === "auto"
    ? card.refreshStatus === "failed"
      ? `<i class="stale-dot"></i> 刷新失败 · 保留最近值`
      : card.refreshMethod === "public-manual"
        ? `<i class="live-dot"></i> 访客刚刚刷新`
        : `<i class="live-dot"></i> 发布时已刷新`
    : "手动口径";
  const maintenanceButton = card.id === 9
    ? `<button class="maintenance-button" type="button" data-maintain-positioning>手动维护</button>`
    : "";
  return `
    <article class="signal-card status-${card.status}">
      <div class="signal-topline">
        <span class="signal-number">${String(card.id).padStart(2, "0")}</span>
        <span class="status-chip"><i>${status.icon}</i>${status.label}</span>
        ${maintenanceButton}
      </div>
      <h3>${escapeHtml(card.title)}</h3>
      <strong class="signal-headline">${escapeHtml(card.headline)}</strong>
      <div class="facts">${card.facts.map((fact) => `<span>${escapeHtml(fact)}</span>`).join("")}</div>
      <p>${escapeHtml(card.detail)}</p>
      <div class="signal-footer">
        <span title="${escapeHtml(card.refreshMessage || "")}">${refreshLabel}</span>
        ${source}
      </div>
    </article>`;
}

function renderSections(cards) {
  $("#sections").innerHTML = Object.entries(SECTION_META).map(([key, meta]) => {
    const items = cards.filter((card) => card.section === key);
    return `
      <section class="signal-section accent-${meta.accent}">
        <div class="section-heading">
          <span>${meta.number}</span>
          <div><h2>${meta.title}</h2><p>${meta.subtitle}</p></div>
          <i></i>
        </div>
        <div class="cards-grid ${items.length === 1 ? "single-card" : ""}">${items.map(renderCard).join("")}</div>
      </section>`;
  }).join("");
}

function renderTracker(data) {
  const ordered = [...data.cards].sort((a, b) => {
    const rank = { green: 0, yellow: 1, red: 2, off: 3 };
    return rank[a.status] - rank[b.status] || a.id - b.id;
  });
  $("#trackerList").innerHTML = ordered.map((card) => `
    <div class="tracker-row">
      <span class="tracker-status tracker-${card.status}">${STATUS[card.status].icon}</span>
      <b>${String(card.id).padStart(2, "0")}</b>
      <span>${escapeHtml(card.shortName)}</span>
      <em>${escapeHtml(card.change || "—")}</em>
    </div>`).join("");
  $("#statusLegend").innerHTML = ["green", "yellow", "red", "off"].map((key) => `
    <div><i class="legend-${key}"></i><strong>${data.counts[key]}</strong><span>${STATUS[key].label}</span></div>`).join("");
}

function renderBriefing(data) {
  $("#summaryText").textContent = data.summary;
  $("#changeTitle").textContent = `核心变化（${data.previous?.date || "上期"} → ${data.date}）`;
  $("#changeList").innerHTML = (data.previous?.changes || ["暂无上期快照，保存今日快照后即可开始对比。"])
    .map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#riskList").innerHTML = (data.risks.length ? data.risks : ["当前规则未识别到突出风险，仍需保持仓位纪律。"])
    .map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#macroList").innerHTML = data.macroNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function render() {
  const data = deriveDashboard(dashboard);
  $("#dashboardDate").textContent = formatDate(data.date);
  $("#updatedAt").textContent = `最后更新 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(data.updatedAt))}`;
  $("#modePill").textContent = data.dataMode;
  $("#modePill").classList.toggle("is-live", data.dataMode.includes("实时"));
  $("#btcPrice").textContent = formatMoney(data.market.btcPrice, 0);
  $("#btcSource").textContent = data.market.btcSource ? `· ${data.market.btcSource}` : "· 最近缓存";
  $("#btcSource").title = data.market.btcFetchedAt
    ? `行情时间 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(data.market.btcFetchedAt))}`
    : "尚未完成实时行情刷新";
  $("#btcChange").textContent = `${data.market.btcChange24h >= 0 ? "↑" : "↓"} ${Math.abs(data.market.btcChange24h).toFixed(2)}%`;
  $("#btcChange").className = `change-pill ${data.market.btcChange24h >= 0 ? "positive" : "negative"}`;
  $("#fngValue").textContent = data.market.fng;
  $("#fngSource").textContent = data.market.fngSource ? `· ${data.market.fngSource}` : "· 最近缓存";
  $("#fngSource").title = data.market.fngFetchedAt ? `指标时间 ${data.market.fngFetchedAt}` : "尚未完成实时刷新";
  $("#fngLabel").textContent = data.heat.label;
  $("#heatFill").style.width = `${data.market.fng}%`;
  $("#heatMarker").style.left = `${data.market.fng}%`;
  $("#wmaRatio").textContent = `${data.market.wmaRatio.toFixed(2)}x`;
  $("#wmaSource").textContent = data.market.wmaSource ? `· ${data.market.wmaSource}` : "· 最近缓存";
  $("#wmaSource").title = data.market.wmaFetchedAt ? `计算时间 ${data.market.wmaFetchedAt}` : "尚未完成实时刷新";
  $("#wmaValue").textContent = formatMoney(data.market.wma200, 0);
  $("#wmaInsight").textContent = data.market.wmaRatio >= 1 ? "价格位于长期成本线上方" : "价格位于长期成本线下方";
  $("#scoreValue").textContent = data.score;
  $("#scoreRing").style.setProperty("--score-angle", `${data.score / data.total * 360}deg`);
  $("#scoreVerdict").textContent = data.counts.red === 0 && data.score >= 6 ? "偏多主导 · 无红灯" : data.counts.red ? `出现 ${data.counts.red} 项风险信号` : "信号分化 · 保持观察";
  renderSections(data.cards);
  renderTracker(data);
  renderBriefing(data);
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "请求失败");
  return payload;
}

function showToast(message, tone = "default", duration = 3800) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${tone}`;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = "toast", duration);
}

async function refreshData() {
  const button = $("#refreshButton");
  if (!dashboard) {
    showToast("看板数据仍在加载，请稍后重试", "warning");
    return;
  }
  button.disabled = true;
  button.classList.add("loading");
  try {
    const result = await refreshPublicDashboard(dashboard);
    if (localStorage.getItem(POSITIONING_STORAGE_KEY)) {
      result.data.dataMode = result.warnings.length ? "本地维护 + 混合数据" : "本地维护 + 实时数据";
    }
    dashboard = result.data;
    render();
    if (result.warnings.length) {
      const warningNames = result.warnings.map((item) => item.split("：")[0]).join("、");
      showToast(`已更新 ${result.updated.length} 项；${warningNames} 刷新失败，已保留最近值`, "warning", 7000);
    } else {
      showToast(`已获取最新数据：${result.updated.join("、")}`, "success", 5000);
    }
  } catch (error) {
    showToast(`刷新失败：${error.message}`, "error");
  } finally {
    button.disabled = false;
    button.classList.remove("loading");
  }
}

function ratioFromFacts(facts, label) {
  const fact = facts.find((item) => item.startsWith(label));
  const value = Number(fact?.match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(value) ? value : null;
}

function applyPositioning(accountRatio, positionRatio, savedAt = new Date().toISOString()) {
  const signal = derivePositioningSignal(accountRatio, positionRatio);
  if (!signal) return false;
  const target = dashboard.cards.find((item) => item.id === 9);
  Object.assign(target, signal, {
    source: { label: "访客手工维护", url: "https://www.binance.com/en/futures/BTCUSDT" },
    marketFetchedAt: savedAt
  });
  dashboard.dataMode = dashboard.dataMode.includes("实时") ? "本地维护 + 实时数据" : "本地维护 + 公开快照";
  return true;
}

function updateMaintenanceRatio() {
  const ratio = calculateBookAccountRatio($("#maintenanceAccountRatio").value, $("#maintenancePositionRatio").value);
  $("#maintenanceBookAccountRatio").textContent = ratio === null ? "—" : ratio.toFixed(2);
  $("#maintenanceBookAccountRatio").classList.toggle("is-invalid", ratio === null);
}

function openPositioningMaintenance() {
  const target = dashboard.cards.find((item) => item.id === 9);
  const accountRatio = target.positioning?.accountRatio ?? ratioFromFacts(target.facts, "账户比");
  const positionRatio = target.positioning?.positionRatio ?? ratioFromFacts(target.facts, "仓位比");
  $("#maintenanceAccountRatio").value = Number.isFinite(accountRatio) ? accountRatio : "";
  $("#maintenancePositionRatio").value = Number.isFinite(positionRatio) ? positionRatio : "";
  updateMaintenanceRatio();
  $("#positioningDialog").showModal();
}

function savePositioningMaintenance(event) {
  event.preventDefault();
  const accountRatio = Number($("#maintenanceAccountRatio").value);
  const positionRatio = Number($("#maintenancePositionRatio").value);
  const savedAt = new Date().toISOString();
  if (!applyPositioning(accountRatio, positionRatio, savedAt)) {
    showToast("账户比必须大于 0，且仓位比必须为有效数字", "error");
    return;
  }
  localStorage.setItem(POSITIONING_STORAGE_KEY, JSON.stringify({ accountRatio, positionRatio, savedAt }));
  $("#positioningDialog").close();
  render();
  showToast("多空比已保存到当前浏览器", "success");
}

function resetPositioningMaintenance() {
  const index = dashboard.cards.findIndex((item) => item.id === 9);
  dashboard.cards[index] = typeof structuredClone === "function"
    ? structuredClone(publishedPositioningCard)
    : JSON.parse(JSON.stringify(publishedPositioningCard));
  dashboard.dataMode = publishedDataMode;
  localStorage.removeItem(POSITIONING_STORAGE_KEY);
  $("#positioningDialog").close();
  render();
  showToast("已恢复发布时的多空比", "success");
}

function buildReport() {
  const data = deriveDashboard(dashboard);
  const cards = data.cards.map((card) => `${STATUS[card.status].emoji} ${String(card.id).padStart(2, "0")} ${card.title} — ${card.headline}\n→ ${card.detail}\n来源：${card.source.label}`).join("\n\n");
  const tracking = data.cards.map((card) => `• #: ${String(card.id).padStart(2, "0")} | 信号: ${card.shortName} | 状态: ${STATUS[card.status].emoji} | 变动: ${card.change}`).join("\n");
  return `${data.date} | BTC ${formatMoney(data.market.btcPrice, 0)} ${data.market.btcChange24h >= 0 ? "↑" : "↓"}${Math.abs(data.market.btcChange24h).toFixed(2)}% | F&G ${data.market.fng} ${data.heat.label} | 200WMA ${data.market.wmaRatio.toFixed(2)}x\n\n${cards}\n\n状态跟踪：\n${tracking}\n\n${data.score}/9 ✅ | ${data.counts.yellow} 🟡 | ${data.counts.red} 🔴 | ${data.counts.off} ❌\n\n⚠️ 风险提示：\n${data.risks.map((item) => `• ${item}`).join("\n")}\n\n总结：${data.summary}\n\n仅供研究，不构成投资建议。`;
}

async function copyReport() {
  try {
    await navigator.clipboard.writeText(buildReport());
    showToast("日报全文已复制", "success");
  } catch {
    showToast("复制失败，请检查浏览器权限", "error");
  }
}

async function saveSnapshot() {
  try {
    const result = await api("/api/snapshot", { method: "POST" });
    showToast(`快照已保存（共 ${result.count} 份）`, "success");
  } catch (error) {
    showToast(`保存快照失败：${error.message}`, "error");
  }
}

async function init() {
  try {
    dashboard = await api(`./dashboard.json?v=${Date.now()}`);
    publishedPositioningCard = typeof structuredClone === "function"
      ? structuredClone(dashboard.cards.find((item) => item.id === 9))
      : JSON.parse(JSON.stringify(dashboard.cards.find((item) => item.id === 9)));
    publishedDataMode = dashboard.dataMode;
    try {
      const saved = JSON.parse(localStorage.getItem(POSITIONING_STORAGE_KEY));
      if (saved) applyPositioning(saved.accountRatio, saved.positionRatio, saved.savedAt);
    } catch {
      localStorage.removeItem(POSITIONING_STORAGE_KEY);
    }
    render();
    $("#refreshButton").disabled = false;
  } catch (error) {
    showToast(`无法载入看板：${error.message}`, "error", 8000);
  }
}

$("#refreshButton").addEventListener("click", refreshData);
$("#snapshotButton").addEventListener("click", saveSnapshot);
$("#copyButton").addEventListener("click", copyReport);
$("#sections").addEventListener("click", (event) => {
  if (event.target.closest("[data-maintain-positioning]")) openPositioningMaintenance();
});
$("#positioningForm").addEventListener("submit", savePositioningMaintenance);
$("#maintenanceAccountRatio").addEventListener("input", updateMaintenanceRatio);
$("#maintenancePositionRatio").addEventListener("input", updateMaintenanceRatio);
$("#resetPositioning").addEventListener("click", resetPositioningMaintenance);
$("#cancelPositioning").addEventListener("click", () => $("#positioningDialog").close());
$("#positioningDialog").addEventListener("click", (event) => {
  if (event.target === $("#positioningDialog")) $("#positioningDialog").close();
});

init();
