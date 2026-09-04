const FORMULA = "mstr_price_usd / net_btc_per_share_usd";
const METHODOLOGY_EFFECTIVE_DATE = "2026-07-23";

function card(data, id) {
  return data.cards.find((item) => item.id === id);
}

function businessDaysSince(dateString, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString || "")) return Infinity;
  const current = new Date(`${dateString}T12:00:00Z`);
  const endParts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/New_York"
  }).formatToParts(now).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const end = new Date(`${endParts.year}-${endParts.month}-${endParts.day}T12:00:00Z`);
  if (!Number.isFinite(current.getTime()) || current > end) return 0;
  let count = 0;
  while (current < end && count < 1000) {
    current.setUTCDate(current.getUTCDate() + 1);
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function positiveNumber(value, label, { min = 0, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= min || number > max) throw new Error(`${label} 无效`);
  return number;
}

function money(value, digits = 2) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function validateStrategyMnavDataset(dataset, { now = new Date() } = {}) {
  if (dataset?.schemaVersion !== 1 || dataset.status !== "active") throw new Error("Strategy mNAV 自动快照尚未启用");
  if (dataset.formula !== FORMULA || dataset.methodologyEffectiveDate !== METHODOLOGY_EFFECTIVE_DATE) {
    throw new Error("Strategy mNAV 快照不是 2026-07-23 起的新口径");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.marketAsOf || "")) throw new Error("Strategy mNAV 行情日期无效");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.basisAsOf || "")) throw new Error("Strategy mNAV 资本结构日期无效");

  const mnav = positiveNumber(dataset.mnav, "Strategy mNAV", { min: 0.2, max: 10 });
  const mstrPriceUsd = positiveNumber(dataset.inputs?.mstrPriceUsd, "MSTR 股价", { min: 1, max: 10_000 });
  const btcPriceUsd = positiveNumber(dataset.inputs?.btcPriceUsd, "BTC 价格", { min: 1_000, max: 10_000_000 });
  const netBtcPerShareUsd = positiveNumber(dataset.inputs?.netBtcPerShareUsd, "Net BTC Per Share ($)", { min: 1, max: 10_000 });
  const expectedMnav = mstrPriceUsd / netBtcPerShareUsd;
  if (Math.abs(expectedMnav - mnav) > 0.03) throw new Error("Strategy mNAV 公式校验失败");

  if (dataset.calculation?.mode === "official-methodology-estimate") {
    const btcHoldings = positiveNumber(dataset.inputs?.btcHoldings, "BTC 持仓", { min: 1, max: 21_000_000 });
    const usdAssetsUsd = positiveNumber(dataset.inputs?.usdAssetsUsd, "USD Assets", { min: 0, max: 1e12 });
    const seniorClaimsUsd = positiveNumber(dataset.inputs?.seniorClaimsUsd, "高级索偿", { min: 0, max: 1e12 });
    const fullyDilutedShares = positiveNumber(dataset.inputs?.fullyDilutedShares, "完全摊薄股数", { min: 1, max: 10e9 });
    const expectedNetBps = ((btcHoldings * btcPriceUsd) + usdAssetsUsd - seniorClaimsUsd) / fullyDilutedShares;
    if (Math.abs(expectedNetBps - netBtcPerShareUsd) > Math.max(0.02, netBtcPerShareUsd * 0.0001)) {
      throw new Error("Strategy Net BPS 资本结构公式校验失败");
    }
  }

  const ageBusinessDays = businessDaysSince(dataset.marketAsOf, now);
  if (ageBusinessDays > 3) throw new Error(`Strategy mNAV 行情已滞后 ${ageBusinessDays} 个交易日`);
  return { mnav, mstrPriceUsd, btcPriceUsd, netBtcPerShareUsd, ageBusinessDays };
}

export function applyStrategyMnavDataset(data, dataset, { now = new Date() } = {}) {
  const values = validateStrategyMnavDataset(dataset, { now });
  const target = card(data, 2);
  if (!target) throw new Error("Strategy mNAV 卡片未找到");
  const directOfficial = dataset.calculation?.mode === "official-live";
  const netBtc = Number(dataset.inputs?.netBtc);
  const fullyDilutedShares = Number(dataset.inputs?.fullyDilutedShares);

  target.title = "Strategy mNAV";
  target.headline = `${values.mnav.toFixed(2)}x · MSTR $${money(values.mstrPriceUsd)}`;
  target.facts = [
    `Net BPS $${money(values.netBtcPerShareUsd)}`,
    Number.isFinite(netBtc) && netBtc > 0
      ? `净 BTC ${Math.round(netBtc).toLocaleString("en-US")} · FDSO ${(fullyDilutedShares / 1e6).toFixed(1)}M`
      : `BTC $${money(values.btcPriceUsd, 0)}`,
    `资本结构截至 ${dataset.basisAsOf}`
  ];
  target.detail = directOfficial
    ? "采用 Strategy 2026-07-23 起最新口径：MSTR 股价 ÷ Net BTC Per Share ($)；数值来自官方看板。"
    : `按 Strategy 2026-07-23 起最新口径估算：MSTR 股价 ÷ Net BTC Per Share ($)；资本结构采用 ${dataset.basisAsOf} 官方披露，行情自动更新。`;
  target.status = values.mnav >= 1 ? "green" : values.mnav >= 0.9 ? "yellow" : "red";
  target.change = `mNAV ${values.mnav.toFixed(2)}x · 最新口径`;
  target.source = {
    label: directOfficial ? "Strategy 官方看板" : "Strategy 官方口径",
    url: dataset.source?.url || "https://www.strategy.com/btc"
  };
  target.refresh = "auto";
  target.refreshStatus = "ok";
  target.refreshMessage = `mNAV / ${target.source.label} · 行情截至 ${dataset.marketAsOf}`;
  target.refreshMethod = "scheduled-snapshot";
  target.dataAsOf = dataset.marketAsOf;
  target.basisAsOf = dataset.basisAsOf;
  target.marketFetchedAt = dataset.generatedAt;
  target.lastRefreshAt = dataset.generatedAt;
  if (Array.isArray(data.previous?.changes)) {
    const line = `② mNAV：${target.change}，${target.detail}`;
    const index = data.previous.changes.findIndex((item) => item.startsWith("② mNAV："));
    if (index >= 0) data.previous.changes[index] = line;
    else data.previous.changes.push(line);
  }
  return target.refreshMessage;
}

export async function updateMnavFromSnapshot(data, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`./strategy-mnav.json?v=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return applyStrategyMnavDataset(data, await response.json());
  } finally {
    clearTimeout(timer);
  }
}

export const STRATEGY_MNAV_FORMULA = FORMULA;
export const STRATEGY_MNAV_METHODOLOGY_EFFECTIVE_DATE = METHODOLOGY_EFFECTIVE_DATE;
export const strategyMnavBusinessDaysSince = businessDaysSince;
