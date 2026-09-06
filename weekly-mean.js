const WEEK = 7 * 86400;
const MONDAY = Date.parse("1970-01-05T00:00:00Z") / 1000;
export const WEEKLY_RULE = "200-completed-weeks-UTC-Monday-v1";

export function validateWeeklySnapshot(dataset, now = new Date()) {
  if (dataset?.schemaVersion !== 1 || dataset.rule !== WEEKLY_RULE || dataset.source?.label !== "Yahoo Finance") throw new Error("200WMA: invalid snapshot schema or source");
  const calculated = calculate200WeekMean(dataset.rows, now);
  if (dataset.asOf !== calculated.asOf || !Number.isFinite(dataset.value) || Math.abs(dataset.value - calculated.value) > 0.000001) throw new Error("200WMA: snapshot formula or date mismatch");
  return calculated;
}

export function currentWeekStart(now = new Date()) {
  const seconds = Math.floor(now.getTime() / 1000);
  return MONDAY + Math.floor((seconds - MONDAY) / WEEK) * WEEK;
}

export function calculate200WeekMean(rows, now = new Date()) {
  if (!Array.isArray(rows)) throw new Error("200WMA: weekly records missing");
  const end = currentWeekStart(now), start = end - 200 * WEEK;
  const prices = new Map();
  for (const row of rows) {
    const timestamp = Number(row.timestamp);
    if (row.timestamp === null || row.timestamp === "" || !Number.isFinite(timestamp)) throw new Error("200WMA: observation timestamp missing");
    // Includes Yahoo's extra current-price point and all unfinished-week candles.
    if (timestamp >= end || timestamp < start) continue;
    if ((timestamp - MONDAY) % WEEK !== 0) throw new Error("200WMA: source is not aligned to UTC Monday");
    if (row.close === null || row.close === "" || !Number.isFinite(Number(row.close)) || Number(row.close) <= 0) throw new Error("200WMA: invalid weekly close");
    const close = Number(row.close);
    if (prices.has(timestamp) && prices.get(timestamp) !== close) throw new Error("200WMA: conflicting duplicate week");
    prices.set(timestamp, close);
  }
  let sum = 0;
  for (let week = start; week < end; week += WEEK) {
    if (!prices.has(week)) throw new Error(`200WMA: missing completed week ${new Date(week * 1000).toISOString().slice(0, 10)}`);
    sum += prices.get(week);
  }
  return { value: sum / 200, sampleCount: 200, rule: WEEKLY_RULE,
    firstWeek: new Date(start * 1000).toISOString(), asOf: new Date(end * 1000 - 1).toISOString() };
}

export async function updateWeeklyMean(data, fetchImpl = globalThis.fetch, now = new Date(), { snapshotFirst = false } = {}) {
  const failures = [];
  if (snapshotFirst) {
    try {
      const response = await fetchImpl(`./weekly-mean.json?v=${now.getTime()}`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const dataset = await response.json();
      const observation = validateWeeklySnapshot(dataset, now);
      Object.assign(data.market, { wma200: observation.value, wmaRatio: data.market.btcPrice / observation.value,
        wmaSource: "Yahoo Finance", wmaFetchedAt: dataset.generatedAt, wmaObservation: observation,
        wmaRefreshStatus: "ok", wmaRefreshError: null });
      return "200WMA / Yahoo Finance · 200 completed UTC Monday weeks";
    } catch (error) { failures.push(`snapshot: ${error.message}`); }
  }
  // Two Yahoo hosts provide endpoint failover, not independent market data.
  // Kraken Thursday candles and DefiLlama nearest-price samples are not comparable closes.
  for (const host of ["query1", "query2"]) {
    try {
      const response = await fetchImpl(`https://${host}.finance.yahoo.com/v8/finance/chart/BTC-USD?range=5y&interval=1wk`, {
        signal: AbortSignal.timeout(10000), cache: "no-store", headers: { accept: "application/json" }
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const series = payload.chart?.result?.[0];
      if (!Array.isArray(series?.timestamp)) throw new Error("weekly series missing");
      const rows = series.timestamp.map((timestamp, i) => ({ timestamp, close: series.indicators?.quote?.[0]?.close?.[i] }));
      const observation = calculate200WeekMean(rows, now);
      Object.assign(data.market, { wma200: observation.value, wmaRatio: data.market.btcPrice / observation.value,
        wmaSource: "Yahoo Finance", wmaFetchedAt: now.toISOString(), wmaObservation: observation,
        wmaRefreshStatus: "ok", wmaRefreshError: null });
      // Keep the validated raw window available to the scheduled snapshot writer.
      data.market.wmaObservation.rows = rows.filter((row) => row.timestamp >= currentWeekStart(now) - 200 * WEEK && row.timestamp < currentWeekStart(now));
      return "200WMA / Yahoo Finance · 200 completed UTC Monday weeks";
    } catch (error) { failures.push(`${host}: ${error.message}`); }
  }
  data.market.wmaRefreshStatus = "failed";
  data.market.wmaRefreshError = failures.join("; ");
  throw new Error(`200WMA: no valid source; previous value retained (${failures.join("; ")})`);
}
