const DAY = 86400000;
export const ONCHAIN = {
  7: { metric: "mvrv_z_score", endpoint: "/v1/metrics/market/mvrv_z_score", auxiliary: "mvrv", auxiliaryEndpoint: "/v1/metrics/market/mvrv", file: "mvrv.json", chart: "market.MvrvZScore", title: "MVRV Z-Score" },
  8: { metric: "puell_multiple", endpoint: "/v1/metrics/indicators/puell_multiple", auxiliary: "sopr", auxiliaryEndpoint: "/v1/metrics/indicators/sopr", file: "puell.json", chart: "indicators.PuellMultiple", title: "Puell Multiple" }
};

export function onchainAgeDays(timestamp, now = new Date()) {
  return Math.floor(now.getTime() / DAY) - timestamp / 86400;
}

function validateObservation(row, id, now) {
  const timestamp = row?.timestamp, value = row?.value;
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp % 86400 !== 0) throw new Error("Invalid UTC daily observation");
  if (onchainAgeDays(timestamp, now) < 1) throw new Error("Incomplete or future UTC daily observation");
  if (onchainAgeDays(timestamp, now) > 3) throw new Error("On-chain observation is older than 3 days");
  if (typeof value !== "number" || !Number.isFinite(value) || value > 100 || (id === 7 ? value < -20 : value <= 0)) throw new Error("Invalid on-chain metric value");
  return row;
}

export function validateOnchainDataset(dataset, id, { now = new Date() } = {}) {
  const config = ONCHAIN[id];
  if (!config || dataset?.schemaVersion !== 1 || dataset.status !== "active" || dataset.asset !== "BTC" || dataset.interval !== "24h" || dataset.metric !== config.metric) throw new Error("On-chain metric identity mismatch");
  if (dataset.source?.endpoint !== config.endpoint || dataset.source?.label !== "Glassnode Public MCP") throw new Error("On-chain source mismatch");
  const row = validateObservation(dataset.observation, id, now);
  if (dataset.value !== row.value || dataset.asOf !== new Date(row.timestamp * 1000).toISOString().slice(0, 10)) throw new Error("On-chain observation date/value mismatch");
  if (dataset.auxiliary != null) {
    if (dataset.auxiliary.metric !== config.auxiliary || dataset.auxiliary.timestamp !== row.timestamp || typeof dataset.auxiliary.value !== "number" || !Number.isFinite(dataset.auxiliary.value) || dataset.auxiliary.value <= 0 || dataset.auxiliary.value > 100) throw new Error("On-chain auxiliary metric/date mismatch");
  }
  return row;
}

export function applyOnchainDataset(data, dataset, id, { now = new Date(), method = "scheduled-snapshot" } = {}) {
  const row = validateOnchainDataset(dataset, id, { now });
  const target = data.cards.find(card => card.id === id);
  if (!target) throw new Error("On-chain card not found");
  if (target.onchain?.timestamp > row.timestamp) throw new Error("On-chain snapshot would roll back the current observation");
  const config = ONCHAIN[id], auxiliary = dataset.auxiliary;
  const low = row.value < (id === 7 ? 0 : 0.5), high = row.value > (id === 7 ? 7 : 4);
  const detail = id === 7
    ? low ? "Z-Score 低于 0，处于历史低估参考区；不代表价格已见底。" : high ? "Z-Score 高于 7，估值偏热，需注意周期风险。" : "Z-Score 处于中间区间，未触及历史低估或过热阈值。"
    : low ? "Puell 低于 0.5，矿工发行收入相对年均值承压；不代表价格已见底。" : high ? "Puell 高于 4，矿工发行收入相对年均值偏高，注意周期风险。" : "Puell 处于 0.5 至 4 区间，未触及极端阈值。";
  Object.assign(target, {
    title: config.title, headline: `${row.value.toFixed(2)}${auxiliary ? ` · ${id === 7 ? "MVRV Ratio" : "SOPR"} ${auxiliary.value.toFixed(id === 7 ? 2 : 3)}` : ""}`,
    facts: [`数据日期 ${dataset.asOf} · UTC 日频`, ...(auxiliary ? [] : ["辅助指标暂无同日数据"])],
    detail, status: low ? "green" : high ? "red" : "yellow", change: `${config.title} ${row.value.toFixed(2)}`,
    source: { label: "Glassnode Public MCP", url: `https://studio.glassnode.com/charts/${config.chart}?a=BTC` },
    onchain: { metric: config.metric, timestamp: row.timestamp, value: row.value },
    dataAsOf: new Date(row.timestamp * 1000).toISOString(), refresh: "auto", refreshStatus: "ok", refreshMethod: method,
    marketFetchedAt: dataset.generatedAt, lastRefreshAt: now.toISOString(), refreshMessage: `${config.title} / Glassnode · ${dataset.asOf}`
  });
  return target.refreshMessage;
}

export async function updateOnchainFromSnapshot(data, id, fetchImpl = globalThis.fetch, now = new Date()) {
  const config = ONCHAIN[id], failures = [];
  for (const base of ["https://raw.githubusercontent.com/hsnbrg2022/hsnbrg2022.github.io/main/", "./"]) {
    try {
      const response = await fetchImpl(`${base}${config.file}?v=${now.getTime()}`, { cache: "no-store", signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return applyOnchainDataset(data, await response.json(), id, { now });
    } catch (error) { failures.push(error.message); }
  }
  throw new Error(`No valid ${config.title} snapshot; previous value retained (${failures.join("; ")})`);
}
