import { FREE_TMM, sameFreeSource } from "./free-onchain-source.js";
const DAY_MS = 86_400_000;
const FORMULA = "glassnode_price_usd_close / glassnode_aviv";

export function trueMarketMeanDay(rawTimestamp, now = new Date()) {
  const timestamp = Number(rawTimestamp);
  const date = new Date(timestamp * 1000);
  if (!((typeof rawTimestamp === "number" || typeof rawTimestamp === "string" && rawTimestamp.trim() !== "")
    && Number.isSafeInteger(timestamp) && timestamp > 0 && timestamp % 86400 === 0
    && Number.isFinite(date.getTime()) && Number.isFinite(now.getTime()))) {
    throw new Error("True Market Mean UTC 日时间戳无效");
  }
  const today = Math.floor(now.getTime() / DAY_MS) * DAY_MS;
  if (date.getTime() > today) throw new Error("True Market Mean 日期位于未来");
  return { timestamp, asOf: date.toISOString().slice(0, 10), ageDays: (today - date.getTime()) / DAY_MS };
}

export function validateTrueMarketMeanDataset(dataset, { now = new Date() } = {}) {
  if (dataset?.schemaVersion !== 1 || dataset.status !== "active") throw new Error("True Market Mean 自动快照尚未启用");
  if (dataset.formula === "published_true_market_mean") {
    if (dataset.asset !== "BTC" || dataset.interval !== "24h" || dataset.metric !== FREE_TMM.metric || !sameFreeSource(dataset.source, FREE_TMM) || dataset.inputs != null || dataset.validation?.activation !== "active") throw new Error("True Market Mean 公开来源口径无效");
    const day = trueMarketMeanDay(dataset.observation?.timestamp, now), raw = dataset.observation?.value, value = dataset.value;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1000 || raw > 500000 || typeof value !== "number" || value !== Number(raw.toFixed(2))) throw new Error("True Market Mean 直接读数校验失败");
    if (day.asOf !== dataset.asOf || day.ageDays < 1 || day.ageDays > 3) throw new Error("True Market Mean 公开日值日期无效或超过3天");
    return { value, ageDays: day.ageDays };
  }
  if (dataset.formula !== FORMULA || dataset.validation?.activation !== "active") throw new Error("True Market Mean 快照口径无效");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.asOf || "")) throw new Error("True Market Mean 日期无效");

  const value = Number(dataset.value);
  const price = Number(dataset.inputs?.priceUsdClose);
  const aviv = Number(dataset.inputs?.aviv);
  const day = trueMarketMeanDay(dataset.inputs?.timestamp, now);
  if (!Number.isFinite(value) || value < 1_000 || value > 500_000) throw new Error("True Market Mean 数值超出合理范围");
  if (!Number.isFinite(price) || price < 1_000 || price > 1_000_000) throw new Error("True Market Mean 的 BTC 收盘价无效");
  if (!Number.isFinite(aviv) || aviv < 0.2 || aviv > 5) throw new Error("True Market Mean 的 AVIV 无效");
  if (day.asOf !== dataset.asOf) {
    throw new Error("True Market Mean 指标日期未对齐");
  }
  if (day.ageDays === 0) throw new Error("True Market Mean 当天 UTC 日尚未完成");

  const expected = price / aviv;
  if (Math.abs(expected - value) > Math.max(0.02, value * 0.000001)) throw new Error("True Market Mean 公式校验失败");
  const ageDays = day.ageDays;
  if (ageDays > 3) throw new Error(`True Market Mean 自动快照已滞后 ${ageDays} 天`);
  return { value, ageDays };
}

export function applyTrueMarketMeanDataset(data, dataset, { now = new Date() } = {}) {
  const { value } = validateTrueMarketMeanDataset(dataset, { now });
  if (data.trueMarketMean?.asOf > dataset.asOf) throw new Error("True Market Mean 快照不得回退到更早日期");
  data.trueMarketMean = {
    ...data.trueMarketMean,
    value,
    asOf: dataset.asOf,
    formula: dataset.formula,
    refresh: "auto",
    refreshStatus: "ok",
    refreshMethod: "scheduled-snapshot",
    refreshMessage: `True Market Mean / ${dataset.source?.label || "Glassnode Public MCP"} · 截至 ${dataset.asOf}`,
    marketFetchedAt: dataset.generatedAt,
    source: {
      label: dataset.source?.label || "Glassnode Public MCP",
      url: dataset.source?.url || "https://studio.glassnode.com/charts/indicators.Aviv?a=BTC"
    }
  };
  return data.trueMarketMean.refreshMessage;
}

export async function updateTrueMarketMeanFromSnapshot(data, fetchImpl = globalThis.fetch, now = new Date()) {
  const failures = [];
  for (const base of ["https://raw.githubusercontent.com/hsnbrg2022/hsnbrg2022.github.io/main/", "./"]) {
    try {
      const response = await fetchImpl(`${base}true-market-mean.json?v=${now.getTime()}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return applyTrueMarketMeanDataset(data, await response.json(), { now });
    } catch (error) { failures.push(error.message); }
  }
  throw new Error(`No valid True Market Mean snapshot; previous value retained (${failures.join("; ")})`);
}
