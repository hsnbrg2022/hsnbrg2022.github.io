import { STATUS, analyzeTrueMarketMean, calculateBookAccountRatio, deriveDashboard, derivePositioningSignal, formatMoney } from "./model.js?v=20260823-2";
import { applyEtfDatasetToDashboard, refreshPublicDashboard } from "./public-refresh.js?v=20260829-2";
import { nextEtfTradingDate, upsertManualEtfFlow } from "./scripts/manual-etf-flow.mjs?v=20260828-1";
import { LANGUAGE_STORAGE_KEY, getInitialLanguage, indicatorHelp, indicatorHelpKeyForCard, indicatorHelpKeyForFact, localizeDashboard, statusLabel, t, translateMode, translateText } from "./i18n.js?v=20260829-2";

const SECTION_META = {
  capital: { number: "01", titleKey: "capital", subtitleKey: "capitalSub", accent: "mint" },
  macro: { number: "02", titleKey: "macro", subtitleKey: "macroSub", accent: "gold" },
  onchain: { number: "03", titleKey: "onchain", subtitleKey: "onchainSub", accent: "blue" },
  positioning: { number: "04", titleKey: "positioning", subtitleKey: "positioningSub", accent: "violet" }
};

let dashboard;
let language = getInitialLanguage();
let publishedEtfDataset;
let currentEtfDataset;
let editingEtfDate = "";
let publishedPositioningCard;
let publishedDataMode;
let activeIndicatorTooltip;
const IS_LOCAL_MAINTENANCE = ["127.0.0.1", "localhost"].includes(location.hostname);
const ETF_STORAGE_KEY = "crypto-signal-tracker:etf-flows-v1";
const POSITIONING_STORAGE_KEY = "crypto-signal-tracker:positioning-v1";
const $ = (selector) => document.querySelector(selector);

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[char]));
}

function renderIndicatorHelp(key, context = key) {
  const help = indicatorHelp(language, key);
  if (!help) return "";
  const tooltipId = `indicator-help-${context}`;
  const points = help.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("");
  const confluence = help.confluence
    ? `<div class="indicator-confluence"><b>${t(language, "confluenceTitle")}</b><span>${escapeHtml(help.confluence)}</span></div>`
    : "";
  return `<span class="indicator-help" data-indicator-help>
    <button class="indicator-help-button" type="button" aria-label="${escapeHtml(t(language, "indicatorHelpLabel", { indicator: help.title }))}" aria-describedby="${tooltipId}" aria-expanded="false">i</button>
    <span id="${tooltipId}" class="indicator-tooltip" role="tooltip" popover="manual">
      <span class="indicator-tooltip-kicker">${t(language, "indicatorGuide")}</span>
      <strong>${escapeHtml(help.title)}</strong>
      <span class="indicator-tooltip-summary">${escapeHtml(help.summary)}</span>
      <ul>${points}</ul>${confluence}
    </span>
  </span>`;
}

function closeIndicatorTooltip(wrapper) {
  if (!wrapper) return;
  const panel = wrapper.querySelector(".indicator-tooltip");
  const button = wrapper.querySelector(".indicator-help-button");
  if (panel?.matches(":popover-open")) panel.hidePopover();
  wrapper.classList.remove("is-open");
  button?.setAttribute("aria-expanded", "false");
  if (activeIndicatorTooltip === wrapper) activeIndicatorTooltip = null;
}

function positionIndicatorTooltip(panel, button) {
  const viewportGap = 16;
  const buttonRect = button.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const left = Math.min(Math.max(buttonRect.left - 12, viewportGap), window.innerWidth - panelRect.width - viewportGap);
  const roomBelow = window.innerHeight - buttonRect.bottom;
  const top = roomBelow >= panelRect.height + 18
    ? buttonRect.bottom + 10
    : Math.max(viewportGap, buttonRect.top - panelRect.height - 10);
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function openIndicatorTooltip(wrapper) {
  if (activeIndicatorTooltip && activeIndicatorTooltip !== wrapper) closeIndicatorTooltip(activeIndicatorTooltip);
  const panel = wrapper.querySelector(".indicator-tooltip");
  const button = wrapper.querySelector(".indicator-help-button");
  if (!panel || !button) return;
  if (typeof panel.showPopover === "function" && !panel.matches(":popover-open")) panel.showPopover();
  wrapper.classList.add("is-open");
  button.setAttribute("aria-expanded", "true");
  activeIndicatorTooltip = wrapper;
  requestAnimationFrame(() => positionIndicatorTooltip(panel, button));
}

function bindIndicatorTooltips() {
  document.querySelectorAll("[data-indicator-help]").forEach((wrapper) => {
    if (wrapper.dataset.bound) return;
    wrapper.dataset.bound = "true";
    wrapper.addEventListener("mouseenter", () => openIndicatorTooltip(wrapper));
    wrapper.addEventListener("mouseleave", () => {
      if (!wrapper.contains(document.activeElement)) closeIndicatorTooltip(wrapper);
    });
    wrapper.addEventListener("focusin", () => openIndicatorTooltip(wrapper));
    wrapper.addEventListener("focusout", (event) => {
      if (!wrapper.contains(event.relatedTarget)) closeIndicatorTooltip(wrapper);
    });
  });
}

function formatDate(dateString) {
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
    .format(new Date(`${dateString}T00:00:00+08:00`));
}

function applyStaticTranslations() {
  document.documentElement.lang = language === "en" ? "en" : "zh-CN";
  document.title = t(language, "brand");
  $(".brand").ariaLabel = t(language, "backTop");
  $(".brand small").textContent = t(language, "brand");
  $("#languageButton").textContent = t(language, "languageButton");
  $("#languageButton").title = t(language, "switchLanguage");
  $("#pageTitle").innerHTML = t(language, "heroTitle");
  $(".hero-copy").textContent = t(language, "heroCopy");
  $(".score-heading span").textContent = t(language, "todayStatus");
  $(".briefing-head h2").textContent = t(language, "briefing");
  $("#copyButton").textContent = t(language, "copy");
  $(".summary-panel .panel-index").textContent = `01 / ${t(language, "summary").toUpperCase()}`;
  $(".change-panel .panel-index").textContent = `02 / ${t(language, "changes").toUpperCase()}`;
  $(".risk-panel h3").textContent = t(language, "risks");
  $(".macro-panel h3").textContent = t(language, "watch");
  $("footer p").textContent = t(language, IS_LOCAL_MAINTENANCE ? "footerLocal" : "footer");
  $("#refreshButton").innerHTML = `<span class="refresh-icon">↻</span> ${t(language, "refresh")}`;
  $("#refreshButton").title = t(language, "refreshTitle");
  $("#positioningDialog h2").textContent = t(language, "positioningTitle");
  $("#positioningNote").textContent = t(language, IS_LOCAL_MAINTENANCE ? "positioningLocalNote" : "positioningNote");
  $("#maintenanceAccountLabel").textContent = t(language, "accountRatio");
  $("#maintenancePositionLabel").textContent = t(language, "positionRatio");
  $("#maintenanceBookLabel").textContent = t(language, "bookAccountRatio");
  $("#maintenanceRatioHelp").textContent = t(language, "ratioHelp");
  $("#resetPositioning").textContent = t(language, "reset");
  $("#cancelPositioning").textContent = t(language, "cancel");
  $("#savePositioning").textContent = t(language, IS_LOCAL_MAINTENANCE ? "saveAndSync" : "saveBrowser");
  $("#resetPositioning").hidden = IS_LOCAL_MAINTENANCE;
  $("#closePositioning").ariaLabel = t(language, "close");
  $("#etfDialogTitle").textContent = t(language, "etfMaintenanceTitle");
  $("#etfDialogNote").textContent = t(language, IS_LOCAL_MAINTENANCE ? "etfLocalNote" : "etfBrowserNote");
  $("#etfDateLabel").textContent = t(language, "etfTradeDate");
  $("#etfFlowLabel").textContent = t(language, "etfNetFlow");
  $("#etfFlowHelp").textContent = t(language, "etfNetFlowHelp");
  $("#etfSourceLabel").textContent = t(language, "etfManualSource");
  $("#etfHistoryTitle").textContent = t(language, "etfRecentHistory");
  $("#etfHistoryHint").textContent = t(language, "etfRecentHistoryHint");
  $("#etfSavePolicy").textContent = t(language, IS_LOCAL_MAINTENANCE ? "etfLocalPolicy" : "etfBrowserPolicy");
  $("#resetEtf").textContent = t(language, "reset");
  $("#resetEtf").hidden = IS_LOCAL_MAINTENANCE;
  $("#cancelEtf").textContent = t(language, "cancel");
  $("#saveEtf").textContent = t(language, IS_LOCAL_MAINTENANCE ? "saveAndSync" : "saveBrowser");
  $("#closeEtf").ariaLabel = t(language, "close");
  syncEtfEditorState();
  $("#fngHelp").innerHTML = renderIndicatorHelp("fearGreed", "fear-greed");
  $("#wmaHelp").innerHTML = renderIndicatorHelp("wma200", "200-wma");
}

function renderCard(card) {
  const status = STATUS[card.status];
  const fetchedAt = card.marketFetchedAt ? ` title="行情时间 ${escapeHtml(card.marketFetchedAt)}"` : "";
  const source = card.source?.url
    ? `<a href="${escapeHtml(card.source.url)}" target="_blank" rel="noreferrer"${fetchedAt}>${escapeHtml(card.source.label)} ↗</a>`
    : `<span>${escapeHtml(card.source?.label || "未填写")}</span>`;
  const dataAsOf = card.dataAsOf ? card.dataAsOf.replaceAll("-", "/") : "—";
  const refreshLabel = card.id === 1 && card.dataAsOf
    ? card.refreshStatus === "failed"
      ? `<i class="stale-dot"></i> ${t(language, "etfFailedAsOf", { date: dataAsOf })}`
      : card.refreshStatus === "stale"
      ? `<i class="stale-dot"></i> ${t(language, "etfStaleAsOf", { date: dataAsOf })}`
      : card.refreshStatus === "snapshot"
        ? `<i class="snapshot-dot"></i> ${t(language, "etfSnapshotAsOf", { date: dataAsOf })}`
        : `<i class="live-dot"></i> ${t(language, "etfLiveAsOf", { date: dataAsOf })}`
    : card.refresh === "auto"
    ? card.refreshStatus === "failed"
      ? `<i class="stale-dot"></i> ${t(language, "refreshFailed")}`
      : card.refreshMethod === "public-manual"
        ? `<i class="live-dot"></i> ${t(language, "visitorRefresh")}`
        : `<i class="live-dot"></i> ${t(language, "publishedRefresh")}`
    : t(language, "manual");
  const maintenanceButton = card.id === 1
    ? `<button class="maintenance-button" type="button" data-maintain-etf>${t(language, "maintain")}</button>`
    : card.id === 9
      ? `<button class="maintenance-button" type="button" data-maintain-positioning>${t(language, "maintain")}</button>`
      : "";
  const helpKey = indicatorHelpKeyForCard(card.id);
  const headlineHelp = card.id === 8 && /SOPR/i.test(card.headline) ? renderIndicatorHelp("sopr", `card-${card.id}-sopr`) : "";
  return `
    <article class="signal-card status-${card.status}">
      <div class="signal-topline">
        <span class="signal-number">${String(card.id).padStart(2, "0")}</span>
        <span class="status-chip"><i>${status.icon}</i>${statusLabel(language, card.status)}</span>
        ${maintenanceButton}
      </div>
      <div class="signal-title-row"><h3>${escapeHtml(card.title)}</h3>${helpKey ? renderIndicatorHelp(helpKey, `card-${card.id}`) : ""}</div>
      <strong class="signal-headline">${escapeHtml(card.headline)}${headlineHelp}</strong>
      <div class="facts">${card.facts.map((fact, index) => {
        const factHelpKey = indicatorHelpKeyForFact(card.id, fact);
        return `<span>${escapeHtml(fact)}${factHelpKey ? renderIndicatorHelp(factHelpKey, `card-${card.id}-fact-${index}`) : ""}</span>`;
      }).join("")}</div>
      <p>${escapeHtml(card.detail)}</p>
      <div class="signal-footer">
        <span title="${escapeHtml(card.refreshMessage || "")}">${refreshLabel}</span>
        ${source}
      </div>
    </article>`;
}

function trueMarketMeanView(data) {
  const metric = data.trueMarketMean;
  const analysis = analyzeTrueMarketMean(data.market.btcPrice, metric);
  if (!analysis) return null;
  const distance = Math.abs(analysis.deviationPct).toFixed(1);
  const insightKey = analysis.relation === "support"
    ? "trueMarketMeanSupport"
    : analysis.relation === "resistance" ? "trueMarketMeanResistance" : "trueMarketMeanTesting";
  const freshnessKey = { fresh: "freshnessFresh", aging: "freshnessAging", stale: "freshnessStale" }[analysis.freshness];
  const asOf = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai"
  }).format(new Date(`${metric.asOf}T00:00:00+08:00`));
  return {
    metric, analysis, asOf,
    insight: t(language, insightKey, { distance }),
    freshnessLabel: t(language, freshnessKey)
  };
}

function renderTrueMarketMean(data) {
  const view = trueMarketMeanView(data);
  if (!view) return "";
  const source = view.metric.source?.url
    ? `<a href="${escapeHtml(view.metric.source.url)}" target="_blank" rel="noreferrer">${escapeHtml(view.metric.source.label)} ↗</a>`
    : `<span>${escapeHtml(view.metric.source?.label || "Glassnode")}</span>`;
  const refreshLabel = view.metric.refreshStatus === "failed"
    ? t(language, "trueMarketMeanFailed")
    : t(language, view.metric.refresh === "auto" ? "trueMarketMeanAuto" : "trueMarketMeanManual");
  return `<article class="true-market-mean relation-${view.analysis.relation} freshness-${view.analysis.freshness}">
    <div class="true-market-mean-topline">
      <span>${t(language, "trueMarketMeanEyebrow")}</span>
      <b>${view.freshnessLabel}</b>
    </div>
    <div class="true-market-mean-main">
      <div>
        <div class="true-market-mean-title"><h3>True Market Mean</h3>${renderIndicatorHelp("trueMarketMean", "true-market-mean")}</div>
        <p>${escapeHtml(view.insight)}</p>
      </div>
      <strong>${formatMoney(view.analysis.value, 0)}</strong>
    </div>
    <div class="true-market-mean-footer">
      <span title="${escapeHtml(view.metric.refreshMessage || "")}">${t(language, "trueMarketMeanAsOf", { date: view.asOf })} · ${refreshLabel}</span>
      ${source}
    </div>
  </article>`;
}

function renderSections(data) {
  const cards = data.cards;
  $("#sections").innerHTML = Object.entries(SECTION_META).map(([key, meta]) => {
    const items = cards.filter((card) => card.section === key);
    return `
      <section class="signal-section accent-${meta.accent}">
        <div class="section-heading">
          <span>${meta.number}</span>
          <div><h2>${t(language, meta.titleKey)}</h2><p>${t(language, meta.subtitleKey)}</p></div>
          <i></i>
        </div>
        ${key === "onchain" ? renderTrueMarketMean(data) : ""}
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
    <div><i class="legend-${key}"></i><strong>${data.counts[key]}</strong><span>${statusLabel(language, key)}</span></div>`).join("");
}

function renderBriefing(data) {
  $("#summaryText").textContent = data.summary;
  $("#changeTitle").textContent = `${t(language, "changes")} (${data.previous?.date || (language === "en" ? "Previous" : "上期")} → ${data.date})`;
  $("#changeList").innerHTML = (data.previous?.changes || ["暂无上期快照，保存今日快照后即可开始对比。"])
    .map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#riskList").innerHTML = (data.risks.length ? data.risks : ["当前规则未识别到突出风险，仍需保持仓位纪律。"])
    .map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  $("#macroList").innerHTML = data.macroNotes.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function render() {
  activeIndicatorTooltip = null;
  applyStaticTranslations();
  const data = localizeDashboard(deriveDashboard(dashboard), language);
  $("#dashboardDate").textContent = formatDate(data.date);
  const updateTime = new Intl.DateTimeFormat(language === "en" ? "en-GB" : "zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "Asia/Shanghai" }).format(new Date(data.updatedAt));
  $("#updatedAt").textContent = t(language, "lastUpdated", { time: updateTime });
  $("#modePill").textContent = translateMode(dashboard.dataMode, language);
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
  $("#wmaInsight").textContent = data.market.wmaRatio >= 1 ? t(language, "aboveWma") : t(language, "belowWma");
  $("#scoreValue").textContent = data.score;
  $("#scoreRing").style.setProperty("--score-angle", `${data.score / data.total * 360}deg`);
  $("#scoreVerdict").textContent = data.counts.red === 0 && data.score >= 6 ? t(language, "bullishNoRed") : data.counts.red ? t(language, "redSignals", { count: data.counts.red }) : t(language, "mixedSignals");
  renderSections(data);
  renderTracker(data);
  renderBriefing(data);
  bindIndicatorTooltips();
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

async function refreshData({ automatic = false } = {}) {
  const button = $("#refreshButton");
  if (!dashboard) {
    showToast(t(language, "loadingDashboard"), "warning");
    return;
  }
  button.disabled = true;
  button.classList.add("loading");
  if (automatic) $("#updatedAt").textContent = t(language, "syncing");
  try {
    const result = IS_LOCAL_MAINTENANCE
      ? await api("/api/refresh", { method: "POST" })
      : await refreshPublicDashboard(dashboard);
    if (!IS_LOCAL_MAINTENANCE) {
      try {
        const savedEtf = JSON.parse(localStorage.getItem(ETF_STORAGE_KEY));
        if (savedEtf?.rows) {
          currentEtfDataset = savedEtf;
          applyEtfDatasetToDashboard(result.data, savedEtf);
          const etfCard = result.data.cards.find((item) => item.id === 1);
          etfCard.refreshStatus = "snapshot";
          etfCard.refreshMessage = `${t(language, "browserOnlyShort")} · ${savedEtf.marketDate}`;
        }
      } catch {
        localStorage.removeItem(ETF_STORAGE_KEY);
      }
    }
    if (!IS_LOCAL_MAINTENANCE && (localStorage.getItem(POSITIONING_STORAGE_KEY) || localStorage.getItem(ETF_STORAGE_KEY))) {
      result.data.dataMode = result.warnings.length ? "本地维护 + 混合数据" : "本地维护 + 实时数据";
    }
    dashboard = result.data;
    render();
    if (result.warnings.length) {
      const warningNames = result.warnings.map((item) => item.split("：")[0]).join("、");
      showToast(language === "en"
        ? `${automatic ? "Auto-refresh" : "Refresh"} updated ${result.updated.length} item(s); ${translateText(warningNames, language)} failed, last values retained.`
        : `${automatic ? "自动刷新" : "刷新"}已更新 ${result.updated.length} 项；${warningNames} 失败，已保留最近值`, "warning", 7000);
    } else {
      const updatedNames = result.updated.map((item) => translateText(item, language)).join(language === "en" ? ", " : "、");
      showToast(language === "en"
        ? `${automatic ? "Page opened and auto-refreshed" : "Latest data loaded"}: ${updatedNames}`
        : `${automatic ? "打开页面已自动刷新" : "已获取最新数据"}：${updatedNames}`, "success", 5000);
    }
  } catch (error) {
    if (automatic) render();
    showToast(`${language === "en" ? "Refresh failed" : "刷新失败"}: ${error.message}`, "error");
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

function cloneValue(value) {
  return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function formatEtfFlow(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "—";
  const sign = numeric > 0 ? "+" : numeric < 0 ? "−" : "";
  return `${sign}$${Math.abs(numeric).toLocaleString(language === "en" ? "en-US" : "zh-CN", { maximumFractionDigits: 2 })}M`;
}

function renderEtfHistory(dataset) {
  const rows = Array.isArray(dataset?.rows) ? dataset.rows.slice(-6).reverse() : [];
  $("#etfHistoryAsOf").textContent = dataset?.marketDate ? dataset.marketDate.replaceAll("-", "/") : "—";
  $("#etfHistory").innerHTML = rows.length
    ? rows.map((row) => `<button type="button" class="etf-history-row ${Number(row.flowUsdMillions) < 0 ? "is-outflow" : ""} ${editingEtfDate === row.date ? "is-editing" : ""}" data-etf-edit-date="${escapeHtml(row.date)}" aria-pressed="${editingEtfDate === row.date}"><span>${escapeHtml(row.date.replaceAll("-", "/"))}</span><strong>${escapeHtml(formatEtfFlow(row.flowUsdMillions))}</strong><em>${t(language, "etfEditAction")}</em></button>`).join("")
    : `<div class="etf-history-row"><span>—</span><strong>—</strong></div>`;
}

function findEtfRecord(date) {
  return Array.isArray(currentEtfDataset?.rows)
    ? currentEtfDataset.rows.find((row) => row.date === date)
    : null;
}

function syncEtfEditorState() {
  const state = $("#etfEditState");
  if (!state) return;
  state.hidden = !editingEtfDate;
  state.textContent = editingEtfDate
    ? t(language, "etfEditingRecord", { date: editingEtfDate.replaceAll("-", "/") })
    : "";
  $("#saveEtf").textContent = editingEtfDate
    ? t(language, IS_LOCAL_MAINTENANCE ? "etfUpdateAndSync" : "etfUpdateBrowser")
    : t(language, IS_LOCAL_MAINTENANCE ? "saveAndSync" : "saveBrowser");
}

function selectEtfRecord(date, { focus = true } = {}) {
  const row = findEtfRecord(date);
  if (!row) return false;
  editingEtfDate = row.date;
  $("#etfDate").value = row.date;
  $("#etfFlow").value = String(row.flowUsdMillions);
  syncEtfEditorState();
  renderEtfHistory(currentEtfDataset);
  if (focus) {
    $("#etfFlow").focus();
    $("#etfFlow").select();
  }
  return true;
}

function applyBrowserEtfDataset(dataset) {
  currentEtfDataset = dataset;
  applyEtfDatasetToDashboard(dashboard, dataset);
  const target = dashboard.cards.find((item) => item.id === 1);
  target.refreshStatus = "snapshot";
  target.refreshMessage = `${t(language, "browserOnlyShort")} · ${dataset.marketDate}`;
  dashboard.dataMode = dashboard.dataMode.includes("实时") ? "本地维护 + 实时数据" : "本地维护 + 公开快照";
}

async function openEtfMaintenance() {
  const dialog = $("#etfDialog");
  $("#etfHistory").textContent = t(language, "etfLoading");
  $("#etfHistoryAsOf").textContent = "—";
  editingEtfDate = "";
  syncEtfEditorState();
  $("#etfFlow").value = "";
  dialog.showModal();
  try {
    let suggestedNextDate;
    if (IS_LOCAL_MAINTENANCE) {
      const result = await api("/api/etf-flows");
      currentEtfDataset = result.dataset;
      suggestedNextDate = result.suggestedNextDate;
    } else if (!currentEtfDataset) {
      currentEtfDataset = await api(`./etf-flows.json?v=${Date.now()}`);
    }
    suggestedNextDate ||= nextEtfTradingDate(currentEtfDataset?.marketDate);
    const initialDate = suggestedNextDate || currentEtfDataset?.marketDate || "";
    $("#etfDate").value = initialDate;
    $("#etfDate").max = new Intl.DateTimeFormat("en-CA", {
      year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai"
    }).format(new Date());
    $("#etfSource").value = /farside/i.test(currentEtfDataset?.source?.label || "") ? "farside" : "sosovalue";
    if (!selectEtfRecord(initialDate, { focus: false })) {
      editingEtfDate = "";
      $("#etfFlow").value = "";
      syncEtfEditorState();
      renderEtfHistory(currentEtfDataset);
    }
    $("#etfFlow").focus();
  } catch (error) {
    dialog.close();
    showToast(`${t(language, "etfLoadFailed")}：${error.message}`, "error");
  }
}

async function saveEtfMaintenance(event) {
  event.preventDefault();
  const button = $("#saveEtf");
  button.disabled = true;
  const input = {
    date: $("#etfDate").value,
    flowUsdMillions: $("#etfFlow").value,
    sourceKey: $("#etfSource").value
  };
  try {
    let action;
    if (IS_LOCAL_MAINTENANCE) {
      const result = await api("/api/etf-flows", { method: "POST", body: JSON.stringify(input) });
      dashboard = result.data;
      currentEtfDataset = result.dataset;
      action = result.action;
      const messageKey = action === "updated" ? "etfUpdated" : "etfSaved";
      showToast(`${t(language, messageKey)} · ${result.publishFiles.join(" + ")}`, "success", 7000);
    } else {
      const result = upsertManualEtfFlow(currentEtfDataset || publishedEtfDataset, input);
      action = result.action;
      localStorage.setItem(ETF_STORAGE_KEY, JSON.stringify(result.dataset));
      applyBrowserEtfDataset(result.dataset);
      showToast(t(language, action === "updated" ? "etfUpdatedBrowser" : "etfSavedBrowser"), "success", 6000);
    }
    editingEtfDate = "";
    $("#etfDialog").close();
    render();
  } catch (error) {
    showToast(`${t(language, "saveFailed")}：${error.message}`, "error", 7000);
  } finally {
    button.disabled = false;
  }
}

function resetEtfMaintenance() {
  if (IS_LOCAL_MAINTENANCE || !publishedEtfDataset) return;
  localStorage.removeItem(ETF_STORAGE_KEY);
  currentEtfDataset = cloneValue(publishedEtfDataset);
  applyEtfDatasetToDashboard(dashboard, currentEtfDataset);
  dashboard.dataMode = localStorage.getItem(POSITIONING_STORAGE_KEY)
    ? dashboard.dataMode.includes("实时") ? "本地维护 + 实时数据" : "本地维护 + 公开快照"
    : dashboard.refreshChecks?.some((item) => item.status === "failed") ? "公开混合数据" : "公开实时数据";
  $("#etfDialog").close();
  render();
  showToast(t(language, "etfResetBrowser"), "success");
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

async function savePositioningMaintenance(event) {
  event.preventDefault();
  const accountRatio = Number($("#maintenanceAccountRatio").value);
  const positionRatio = Number($("#maintenancePositionRatio").value);
  const savedAt = new Date().toISOString();
  if (!derivePositioningSignal(accountRatio, positionRatio)) {
    showToast(t(language, "invalidRatio"), "error");
    return;
  }
  const button = $("#savePositioning");
  button.disabled = true;
  try {
    if (IS_LOCAL_MAINTENANCE) {
      const result = await api("/api/positioning", {
        method: "POST",
        body: JSON.stringify({ accountRatio, positionRatio })
      });
      dashboard = result.data;
      showToast(`${t(language, "savedPositioningLocal")} · ${result.publishFiles.join(" + ")}`, "success", 7000);
    } else {
      applyPositioning(accountRatio, positionRatio, savedAt);
      localStorage.setItem(POSITIONING_STORAGE_KEY, JSON.stringify({ accountRatio, positionRatio, savedAt }));
      showToast(t(language, "savedPositioning"), "success");
    }
    $("#positioningDialog").close();
    render();
  } catch (error) {
    showToast(`${t(language, "saveFailed")}：${error.message}`, "error", 7000);
  } finally {
    button.disabled = false;
  }
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
  showToast(t(language, "resetPositioning"), "success");
}

function buildReport() {
  const data = localizeDashboard(deriveDashboard(dashboard), language);
  const trueMean = trueMarketMeanView(data);
  const trueMeanLine = trueMean ? `True Market Mean ${formatMoney(trueMean.analysis.value, 0)} | ${trueMean.insight} | ${t(language, "trueMarketMeanAsOf", { date: trueMean.asOf })}` : "";
  const cards = data.cards.map((card) => `${STATUS[card.status].emoji} ${String(card.id).padStart(2, "0")} ${card.title} — ${card.headline}\n→ ${card.detail}\n来源：${card.source.label}`).join("\n\n");
  const tracking = data.cards.map((card) => `• #: ${String(card.id).padStart(2, "0")} | 信号: ${card.shortName} | 状态: ${STATUS[card.status].emoji} | 变动: ${card.change}`).join("\n");
  if (language === "en") {
    return `${data.date} | BTC ${formatMoney(data.market.btcPrice, 0)} ${data.market.btcChange24h >= 0 ? "↑" : "↓"}${Math.abs(data.market.btcChange24h).toFixed(2)}% | F&G ${data.market.fng} ${data.heat.label} | 200WMA ${data.market.wmaRatio.toFixed(2)}x\n${trueMeanLine}\n\n${cards.replaceAll("来源：", "Source: ")}\n\nSignal tracker:\n${tracking.replaceAll("信号:", "Signal:").replaceAll("状态:", "Status:").replaceAll("变动:", "Change:")}\n\n${data.score}/9 active | ${data.counts.yellow} watch | ${data.counts.red} risk | ${data.counts.off} inactive\n\nRisk alerts:\n${data.risks.map((item) => `• ${item}`).join("\n")}\n\nSummary: ${data.summary}\n\nFor research only; not financial advice.`;
  }
  return `${data.date} | BTC ${formatMoney(data.market.btcPrice, 0)} ${data.market.btcChange24h >= 0 ? "↑" : "↓"}${Math.abs(data.market.btcChange24h).toFixed(2)}% | F&G ${data.market.fng} ${data.heat.label} | 200WMA ${data.market.wmaRatio.toFixed(2)}x\n${trueMeanLine}\n\n${cards}\n\n状态跟踪：\n${tracking}\n\n${data.score}/9 ✅ | ${data.counts.yellow} 🟡 | ${data.counts.red} 🔴 | ${data.counts.off} ❌\n\n⚠️ 风险提示：\n${data.risks.map((item) => `• ${item}`).join("\n")}\n\n总结：${data.summary}\n\n仅供研究，不构成投资建议。`;
}

async function copyReport() {
  try {
    await navigator.clipboard.writeText(buildReport());
    showToast(language === "en" ? "Report copied" : "日报全文已复制", "success");
  } catch {
    showToast(language === "en" ? "Copy failed. Check browser permissions." : "复制失败，请检查浏览器权限", "error");
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
    dashboard = await api(IS_LOCAL_MAINTENANCE ? "/api/dashboard" : `./dashboard.json?v=${Date.now()}`);
    const etfResult = IS_LOCAL_MAINTENANCE
      ? await api("/api/etf-flows")
      : { dataset: await api(`./etf-flows.json?v=${Date.now()}`) };
    publishedEtfDataset = cloneValue(etfResult.dataset);
    currentEtfDataset = cloneValue(publishedEtfDataset);
    publishedPositioningCard = cloneValue(dashboard.cards.find((item) => item.id === 9));
    publishedDataMode = dashboard.dataMode;
    if (!IS_LOCAL_MAINTENANCE) {
      try {
        const savedEtf = JSON.parse(localStorage.getItem(ETF_STORAGE_KEY));
        if (savedEtf?.rows) applyBrowserEtfDataset(savedEtf);
      } catch {
        localStorage.removeItem(ETF_STORAGE_KEY);
      }
      try {
        const saved = JSON.parse(localStorage.getItem(POSITIONING_STORAGE_KEY));
        if (saved) applyPositioning(saved.accountRatio, saved.positionRatio, saved.savedAt);
      } catch {
        localStorage.removeItem(POSITIONING_STORAGE_KEY);
      }
    }
    render();
    await refreshData({ automatic: true });
  } catch (error) {
    showToast(`${language === "en" ? "Unable to load dashboard" : "无法载入看板"}：${error.message}`, "error", 8000);
  }
}

$("#refreshButton").addEventListener("click", refreshData);
$("#languageButton").addEventListener("click", () => {
  language = language === "zh" ? "en" : "zh";
  localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  render();
  showToast(t(language, "languageChanged"), "success");
});
$("#snapshotButton").addEventListener("click", saveSnapshot);
$("#copyButton").addEventListener("click", copyReport);
$("#sections").addEventListener("click", (event) => {
  if (event.target.closest("[data-maintain-etf]")) openEtfMaintenance();
  if (event.target.closest("[data-maintain-positioning]")) openPositioningMaintenance();
});
$("#etfForm").addEventListener("submit", saveEtfMaintenance);
$("#etfHistory").addEventListener("click", (event) => {
  const record = event.target.closest("[data-etf-edit-date]");
  if (record) selectEtfRecord(record.dataset.etfEditDate);
});
$("#etfDate").addEventListener("change", () => {
  const date = $("#etfDate").value;
  if (selectEtfRecord(date, { focus: false })) return;
  editingEtfDate = "";
  $("#etfFlow").value = "";
  syncEtfEditorState();
  renderEtfHistory(currentEtfDataset);
});
$("#resetEtf").addEventListener("click", resetEtfMaintenance);
$("#closeEtf").addEventListener("click", () => $("#etfDialog").close());
$("#cancelEtf").addEventListener("click", () => $("#etfDialog").close());
$("#etfDialog").addEventListener("click", (event) => {
  if (event.target === $("#etfDialog")) $("#etfDialog").close();
});
$("#positioningForm").addEventListener("submit", savePositioningMaintenance);
$("#maintenanceAccountRatio").addEventListener("input", updateMaintenanceRatio);
$("#maintenancePositionRatio").addEventListener("input", updateMaintenanceRatio);
$("#resetPositioning").addEventListener("click", resetPositioningMaintenance);
$("#closePositioning").addEventListener("click", () => $("#positioningDialog").close());
$("#cancelPositioning").addEventListener("click", () => $("#positioningDialog").close());
$("#positioningDialog").addEventListener("click", (event) => {
  if (event.target === $("#positioningDialog")) $("#positioningDialog").close();
});

init();
