const DAY = 86400000;
const RULE = "stablecoin-dated-7d-v1";
const SOURCE = { label: "DefiLlama", url: "https://defillama.com/stablecoins" };
const AUX_SOURCE = { label: "CoinGecko", url: "https://www.coingecko.com/en/categories/stablecoins" };
const positive = value => Number.isFinite(value) && value > 0;
const signed = value => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

export function stablecoinQuality(reading, now = new Date()) {
  const asOf = reading?.asOf;
  const latest = Date.parse(asOf), baseline = Date.parse(reading?.baselineAsOf);
  const valid = reading?.rule === RULE && reading.period === "7d" && reading.source === "DefiLlama" && reading.universe === "peggedUSD"
    && positive(reading.total) && positive(reading.baselineTotal) && Number.isFinite(reading.change)
    && Number.isFinite(latest) && latest % DAY === 0 && new Date(latest).toISOString() === asOf
    && Number.isFinite(baseline) && new Date(baseline).toISOString() === reading.baselineAsOf && latest - baseline === 7 * DAY
    && Math.abs(reading.change - (reading.total / reading.baselineTotal - 1) * 100) < 1e-9;
  if (!valid || latest > +now) return { state: "unknown", eligible: false, asOf: asOf || null, reason: "stablecoinUnverified" };
  const ageDays = (+now - latest) / DAY;
  return { state: ageDays > 3 ? "stale" : "fresh", eligible: ageDays <= 3, asOf, ageDays };
}

export function normalizeStablecoinHistory(rows, now = new Date()) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("Stablecoin history is empty");
  const byDate = new Map();
  for (const row of rows) {
    const date = Number(row.date) * 1000;
    const total = row.totalCirculatingUSD?.peggedUSD;
    if (!Number.isSafeInteger(date) || date <= 0 || date % DAY !== 0 || date > +now) throw new Error("Invalid stablecoin UTC date");
    if (byDate.has(date) && byDate.get(date) !== total) throw new Error("Conflicting stablecoin date");
    byDate.set(date, total);
  }
  const latest = Math.max(...byDate.keys()), baseline = latest - 7 * DAY;
  const total = byDate.get(latest), baselineTotal = byDate.get(baseline);
  if (!positive(total) || !positive(baselineTotal)) throw new Error("Missing valid seven-day comparison sample");
  const reading = {
    rule: RULE, period: "7d", source: "DefiLlama", universe: "peggedUSD",
    asOf: new Date(latest).toISOString(), baselineAsOf: new Date(baseline).toISOString(),
    total, baselineTotal, change: (total / baselineTotal - 1) * 100
  };
  if (!stablecoinQuality(reading, now).eligible) throw new Error("Stablecoin seven-day reading is stale");
  return reading;
}

export function normalizeStablecoinAux(rows, now = new Date()) {
  const row = Array.isArray(rows) ? rows.find(item => item.id === "stablecoins") : null;
  if (!positive(row?.market_cap) || !Number.isFinite(row?.market_cap_change_24h)) throw new Error("Invalid stablecoin auxiliary reading");
  const date = Date.parse(row.updated_at);
  if (Number.isFinite(date) && date > +now) throw new Error("Future stablecoin auxiliary date");
  return { period: "24h", universe: "coingecko-stablecoins-category", total: row.market_cap, change: row.market_cap_change_24h,
    asOf: Number.isFinite(date) ? new Date(date).toISOString() : null, fetchedAt: now.toISOString(), source: AUX_SOURCE };
}

// Both environments await the same dated primary source before trying the auxiliary.
// A 24h fallback may add context, but never replaces the last seven-day reading.
export async function updateStablecoins(data, fetchJson, { now } = {}) {
  const target = data.cards.find(item => item.id === 3);
  let primaryError;
  try {
    const reading = normalizeStablecoinHistory(await fetchJson("https://stablecoins.llama.fi/stablecoincharts/all"), now);
    if (target.stablecoin?.asOf && Date.parse(reading.asOf) < Date.parse(target.stablecoin.asOf)) throw new Error("Stablecoin date regression rejected");
    Object.assign(target, {
      stablecoin: reading,
      headline: `$${(reading.total / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 亿 · 7d ${signed(reading.change)}`,
      facts: ["USD 锚定样本 · 同源七日比较", `${reading.baselineAsOf.slice(0, 10)} → ${reading.asOf.slice(0, 10)} (UTC)`],
      detail: reading.change >= 0 ? "稳定币供给保持扩张，链上可用流动性改善。" : "稳定币供给出现收缩，需关注链上流动性压力。",
      status: reading.change > 0 ? "green" : reading.change > -0.3 ? "yellow" : "red",
      change: `7d ${signed(reading.change)}`, source: SOURCE, dataAsOf: reading.asOf, marketFetchedAt: reading.asOf,
      refresh: "auto", refreshStatus: "ok"
    });
    delete target.stablecoinAux;
    return "稳定币 / DefiLlama";
  } catch (error) { primaryError = error.message; }
  try {
    const auxiliary = normalizeStablecoinAux(await fetchJson("https://api.coingecko.com/api/v3/coins/categories"), now);
    const oldDate = Date.parse(target.stablecoinAux?.asOf), newDate = Date.parse(auxiliary.asOf);
    if (Number.isFinite(oldDate) && (!Number.isFinite(newDate) || newDate < oldDate)) throw new Error("Auxiliary date regression rejected");
    target.stablecoinAux = auxiliary;
  } catch (error) {
    throw new Error(`7d: ${primaryError}; 24h: ${error.message}`);
  }
  // Report the main series as failed even when non-comparable context was retrieved.
  throw new Error(`7d: ${primaryError}; CoinGecko 24h context only; seven-day reading retained`);
}
