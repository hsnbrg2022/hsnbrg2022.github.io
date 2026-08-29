const DAY_MS = 86_400_000;
const FORMULA = "glassnode_price_usd_close / glassnode_aviv";

function utcDay(value) {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function validateTrueMarketMeanDataset(dataset, { now = new Date() } = {}) {
  if (dataset?.schemaVersion !== 1 || dataset.status !== "active") throw new Error("True Market Mean 自动快照尚未启用");
  if (dataset.formula !== FORMULA || dataset.validation?.activation !== "active") throw new Error("True Market Mean 快照口径无效");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataset.asOf || "")) throw new Error("True Market Mean 日期无效");

  const value = Number(dataset.value);
  const price = Number(dataset.inputs?.priceUsdClose);
  const aviv = Number(dataset.inputs?.aviv);
  const timestamp = Number(dataset.inputs?.timestamp);
  if (!Number.isFinite(value) || value < 1_000 || value > 500_000) throw new Error("True Market Mean 数值超出合理范围");
  if (!Number.isFinite(price) || price < 1_000 || price > 1_000_000) throw new Error("True Market Mean 的 BTC 收盘价无效");
  if (!Number.isFinite(aviv) || aviv < 0.2 || aviv > 5) throw new Error("True Market Mean 的 AVIV 无效");
  if (!Number.isFinite(timestamp) || new Date(timestamp * 1000).toISOString().slice(0, 10) !== dataset.asOf) {
    throw new Error("True Market Mean 指标日期未对齐");
  }

  const expected = price / aviv;
  if (Math.abs(expected - value) > Math.max(0.02, value * 0.000001)) throw new Error("True Market Mean 公式校验失败");
  const ageDays = Math.max(0, Math.floor((utcDay(now) - utcDay(`${dataset.asOf}T00:00:00Z`)) / DAY_MS));
  if (ageDays > 3) throw new Error(`True Market Mean 自动快照已滞后 ${ageDays} 天`);
  return { value, ageDays };
}

export function applyTrueMarketMeanDataset(data, dataset, { now = new Date() } = {}) {
  const { value } = validateTrueMarketMeanDataset(dataset, { now });
  data.trueMarketMean = {
    ...data.trueMarketMean,
    value,
    asOf: dataset.asOf,
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
