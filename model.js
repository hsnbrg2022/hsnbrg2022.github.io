import { assessCards } from "./data-quality.js?v=20260905-2";

export const STATUS = {
  green: { icon: "✓", emoji: "✅", label: "触发", score: 1 },
  yellow: { icon: "!", emoji: "🟡", label: "观察", score: 0 },
  red: { icon: "↓", emoji: "🔴", label: "风险", score: 0 },
  off: { icon: "×", emoji: "❌", label: "未触发", score: 0 }
};

export function statusCounts(cards = []) {
  return cards.reduce((counts, card) => {
    counts[card.status] = (counts[card.status] || 0) + 1;
    return counts;
  }, { green: 0, yellow: 0, red: 0, off: 0 });
}

export function calculateBookAccountRatio(accountRatio, positionRatio) {
  if (accountRatio === "" || positionRatio === "") return null;
  const account = Number(accountRatio);
  const position = Number(positionRatio);
  if (!Number.isFinite(account) || !Number.isFinite(position) || account <= 0) return null;
  return position / account;
}

export function derivePositioningSignal(accountRatio, positionRatio) {
  const account = Number(accountRatio);
  const position = Number(positionRatio);
  const bookAccountRatio = calculateBookAccountRatio(accountRatio, positionRatio);
  if (bookAccountRatio === null) return null;
  const institutionalLock = account <= 1.15 && position >= 1.5 && bookAccountRatio >= 1.4;
  const crowded = account >= 1.5 && position >= 1.5;
  return {
    positioning: { accountRatio: account, positionRatio: position, bookAccountRatio },
    facts: [`账户比 ${account.toFixed(2)}`, `仓位比 ${position.toFixed(2)}`, `仓帐比 ${bookAccountRatio.toFixed(2)}`],
    headline: institutionalLock ? "机构锁仓做多（S+级）" : crowded ? "多头拥挤" : "结构中性",
    detail: institutionalLock
      ? "账户比偏低而大户仓位比偏高，落入机构锁仓象限。"
      : crowded ? "账户与仓位同步偏多，需警惕杠杆拥挤。" : "账户与仓位差异不显著，暂无强结构信号。",
    status: institutionalLock ? "green" : "yellow",
    change: institutionalLock ? `🟦S+ 仓帐比${bookAccountRatio.toFixed(2)}` : `仓帐比${bookAccountRatio.toFixed(2)}`
  };
}

export function calculateDxyFromRates(rates = {}) {
  const required = ["EUR", "JPY", "GBP", "CAD", "SEK", "CHF"];
  if (!required.every((key) => Number.isFinite(Number(rates[key])) && Number(rates[key]) > 0)) return null;
  return 50.14348112
    * Math.pow(1 / Number(rates.EUR), -0.576)
    * Math.pow(Number(rates.JPY), 0.136)
    * Math.pow(1 / Number(rates.GBP), -0.119)
    * Math.pow(Number(rates.CAD), 0.091)
    * Math.pow(Number(rates.SEK), 0.042)
    * Math.pow(Number(rates.CHF), 0.036);
}

export function marketHeat(fng = 0) {
  if (fng >= 75) return { label: "极度贪婪", tone: "red" };
  if (fng >= 55) return { label: "贪婪", tone: "amber" };
  if (fng >= 45) return { label: "中性", tone: "neutral" };
  if (fng >= 25) return { label: "恐惧", tone: "blue" };
  return { label: "极度恐惧", tone: "blue" };
}

export function analyzeTrueMarketMean(btcPrice, metric, now = new Date()) {
  const price = Number(btcPrice);
  const value = Number(metric?.value);
  const asOf = metric?.asOf;
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(value) || value <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(asOf || "")) return null;
  const deviationPct = ((price / value) - 1) * 100;
  const relation = Math.abs(deviationPct) <= 2 ? "testing" : deviationPct > 0 ? "support" : "resistance";
  const sourceDate = new Date(`${asOf}T00:00:00+08:00`);
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Shanghai"
  }).formatToParts(now).reduce((parts, part) => ({ ...parts, [part.type]: part.value }), {});
  const currentDate = new Date(`${dateParts.year}-${dateParts.month}-${dateParts.day}T00:00:00+08:00`);
  const ageDays = Math.max(0, Math.floor((currentDate - sourceDate) / 86_400_000));
  const freshness = ageDays <= 3 ? "fresh" : ageDays <= 7 ? "aging" : "stale";
  return { value, deviationPct, relation, ageDays, freshness };
}

export function buildRisks(data) {
  const risks = [];
  const { market, cards } = data;
  if (market.fng >= 70) risks.push(`F&G ${market.fng} ${marketHeat(market.fng).label}——情绪进入偏热区，注意追高风险`);
  if (market.btcChange24h >= 6) risks.push(`BTC 24h 上涨 ${market.btcChange24h.toFixed(2)}%，短线波动放大，需留意获利盘承接`);
  for (const card of cards.filter((item) => item.status === "red")) {
    risks.push(`${card.title}亮红灯：${card.detail}`);
  }
  const puell = cards.find((item) => item.id === 8);
  if (puell?.status === "yellow") risks.push(`Puell 仍在观察区，矿工端压力尚未完全解除`);
  const mnav = cards.find((item) => item.id === 2);
  if (mnav?.status === "yellow") risks.push(`Strategy mNAV 低于 1.0，市场价格低于 Net BPS 参考线`);
  return risks.slice(0, 5);
}

export function buildSummary(data) {
  const eligible = data.cards.filter((card) => card.quality?.eligible !== false);
  const counts = statusCounts(eligible);
  const total = data.cards.length;
  const capital = eligible.filter((card) => card.section === "capital");
  const capitalGreen = capital.filter((card) => card.status === "green").length;
  const positioning = eligible.find((card) => card.id === 9);
  const direction = counts.red === 0 && counts.green >= 5 ? "偏多主导" : counts.red >= 3 ? "风险主导" : "多空拉锯";
  const basic = `看板当期确认 ${counts.green}/${total} 项触发，有效覆盖 ${eligible.length}/${total}，${total - eligible.length} 项待更新或核验。${eligible.length < total ? "覆盖不完整，不作全局方向确认。" : `当期 ${counts.red} 项红灯，整体维持${direction}。`}`;
  const money = `资金面当期 ${capitalGreen}/3 项触发（有效覆盖 ${capital.length}/3），需结合 ETF 净流量、稳定币供给与 mNAV 分别判断。`;
  const mood = data.market.fng >= 70
    ? `情绪面处于${marketHeat(data.market.fng).label}，需留意追高风险。`
    : `情绪面处于${marketHeat(data.market.fng).label}，尚未进入极端拥挤区。`;
  const structure = !positioning ? "多空比待更新或核验，暂不作结构判断。" : positioning.status === "green"
    ? `衍生品结构偏多（${positioning.headline}），但需防范杠杆集中后的反向波动。`
    : `衍生品结构尚未形成一致方向。`;
  return [basic, money, mood, structure].join("");
}

export function buildCurrentChanges(data, language = "zh") {
  const en = language === "en";
  const lines = [];
  const previous = Number(data.previous?.btcPrice);
  const current = Number(data.market?.btcPrice);
  if (Number.isFinite(previous) && previous > 0 && Number.isFinite(current) && current > 0) {
    const delta = ((current / previous) - 1) * 100;
    lines.push(`BTC ${formatMoney(previous, 0)} → ${formatMoney(current, 0)} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%)`);
  } else if (Number.isFinite(current) && current > 0) {
    lines.push(`BTC ${formatMoney(current, 0)}`);
  }
  const fng = data.market?.fng;
  if (Number.isFinite(fng)) lines.push(`F&G ${Number.isFinite(data.previous?.fng) ? `${data.previous.fng} → ` : ""}${fng}`);
  for (const id of [1, 2, 3, 6, 9]) {
    const item = data.cards.find((card) => card.id === id);
    if (item) lines.push(`${String(id).padStart(2, "0")} ${item.title} ${en ? "currently" : "当前"}：${item.headline}`);
  }
  return lines;
}

// A delayed refresh must not replace a manual edit made after that refresh started.
export function mergeRefreshView(current, started, incoming) {
  const later = Date.parse(current.updatedAt) > Date.parse(incoming.updatedAt) ? current : incoming;
  return {
    ...incoming,
    date: later.date,
    updatedAt: later.updatedAt,
    dataMode: later.dataMode,
    cards: incoming.cards.map((item) => {
      const latest = current.cards.find((card) => card.id === item.id);
      const before = started.cards.find((card) => card.id === item.id);
      return latest && (item.id === 9 || (item.id === 1 && JSON.stringify(latest) !== JSON.stringify(before))) ? latest : item;
    })
  };
}

// Saving one card must not roll back unrelated quotes that arrived during the request.
export function mergeMaintenanceView(current, saved, id) {
  const later = Date.parse(saved.updatedAt) >= Date.parse(current.updatedAt) ? saved : current;
  return {
    ...current, date: later.date, updatedAt: later.updatedAt, dataMode: saved.dataMode,
    cards: current.cards.map((item) => item.id === id ? saved.cards.find((card) => card.id === id) || item : item)
  };
}

export function deriveDashboard(data, now = new Date()) {
  const { cards, coverage } = assessCards(data.cards, now);
  const counts = statusCounts(cards.filter((card) => card.quality.eligible));
  const assessed = { ...data, cards };
  return {
    ...data,
    cards, coverage, pending: cards.length - coverage,
    previous: { ...data.previous, changes: buildCurrentChanges(data) },
    counts,
    score: counts.green,
    total: data.cards.length,
    heat: marketHeat(data.market.fng),
    risks: buildRisks({ ...data, cards: cards.filter((card) => card.quality.eligible) }),
    summary: buildSummary(assessed)
  };
}

export function formatMoney(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: digits
  }).format(value);
}

export function validateDashboard(data) {
  if (!data || typeof data !== "object") throw new Error("看板数据不能为空");
  if (!Array.isArray(data.cards) || data.cards.length !== 9) throw new Error("看板必须包含 9 项指标");
  if (!analyzeTrueMarketMean(data.market?.btcPrice, data.trueMarketMean)) throw new Error("True Market Mean 数据无效");
  const ids = new Set(data.cards.map((card) => card.id));
  if (ids.size !== 9) throw new Error("指标编号不可重复");
  for (const card of data.cards) {
    if (!STATUS[card.status]) throw new Error(`指标 ${card.id} 的状态无效`);
    if (!card.title || !card.section) throw new Error(`指标 ${card.id} 缺少必要字段`);
  }
  return true;
}
