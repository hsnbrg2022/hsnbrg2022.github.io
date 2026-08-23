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
  if (mnav?.status === "yellow") risks.push(`Strategy mNAV 尚未稳定站上 1.0，飞轮效应仍待确认`);
  return risks.slice(0, 5);
}

export function buildSummary(data) {
  const counts = statusCounts(data.cards);
  const total = data.cards.length;
  const capital = data.cards.filter((card) => card.section === "capital");
  const capitalGreen = capital.filter((card) => card.status === "green").length;
  const positioning = data.cards.find((card) => card.id === 9);
  const direction = counts.red === 0 && counts.green >= 5 ? "偏多主导" : counts.red >= 3 ? "风险主导" : "多空拉锯";
  const basic = `看板 ${counts.green}/${total} 项触发，${counts.red} 项红灯，整体维持${direction}。`;
  const money = capitalGreen >= 2
    ? `资金面有 ${capitalGreen}/${capital.length} 项确认，增量资本仍在入场。`
    : `资金面仅 ${capitalGreen}/${capital.length} 项确认，增量资金需要继续观察。`;
  const mood = data.market.fng >= 70
    ? `情绪面处于${marketHeat(data.market.fng).label}，趋势虽强但追高性价比下降。`
    : `情绪面处于${marketHeat(data.market.fng).label}，尚未进入极端拥挤区。`;
  const structure = positioning?.status === "green"
    ? `衍生品结构偏多（${positioning.headline}），但需防范杠杆集中后的反向波动。`
    : `衍生品结构尚未形成一致方向。`;
  return [basic, money, mood, structure].join("");
}

export function deriveDashboard(data) {
  const counts = statusCounts(data.cards);
  return {
    ...data,
    counts,
    score: counts.green,
    total: data.cards.length,
    heat: marketHeat(data.market.fng),
    risks: buildRisks(data),
    summary: buildSummary(data)
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
