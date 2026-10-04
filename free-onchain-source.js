// Public daily observations, collected server-side; never execute upstream scripts.
export const FREE_ONCHAIN = {
  7: { label: "OnChainLab", metric: "mvrv_z_score", endpoint: "https://onchainlab.net/data/series/mvrv_zscore.json", url: "https://onchainlab.net/metrics/mvrv-zscore" },
  8: { label: "Checkonchain", metric: "puell_multiple", trace: "Puell Multiple", endpoint: "https://charts-cdn.checkonchain.com/btconchain/mining/puellmultiple/puellmultiple_light.html", url: "https://charts.checkonchain.com/btconchain/mining/puellmultiple/puellmultiple_light.html" }
};
export const FREE_TMM = { label: "Checkonchain", metric: "true_market_mean", trace: "True Market Mean", endpoint: "https://charts-cdn.checkonchain.com/btconchain/cointime/pricing_mvrv_aviv_1/pricing_mvrv_aviv_1_light.html", url: "https://charts.checkonchain.com/btconchain/cointime/pricing_mvrv_aviv_1/pricing_mvrv_aviv_1_light.html" };

export function sameFreeSource(actual, expected) {
  return actual?.label === expected.label && actual?.endpoint === expected.endpoint && actual?.url === expected.url;
}

function dailyTimestamp(raw) {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:Z)?)?$/.test(raw)) throw new Error("Invalid source daily date");
  const date = raw.slice(0, 10), timestamp = Date.parse(`${date}T00:00:00Z`) / 1000;
  if (!Number.isSafeInteger(timestamp) || new Date(timestamp * 1000).toISOString().slice(0, 10) !== date) throw new Error("Invalid source calendar date");
  return timestamp;
}

function recentRows(dates, values) {
  if (!Array.isArray(dates) || !dates.length || dates.length > 20000 || dates.length !== values.length) throw new Error("Source daily series length mismatch");
  const timestamps = dates.map(dailyTimestamp), latest = Math.max(...timestamps);
  // Older chart history may contain NaN before a metric existed. Only recent
  // observations are needed, and every recent value must be valid (no backfill).
  return timestamps.flatMap((timestamp, index) => {
    if (timestamp < latest - 7 * 86400) return [];
    const value = values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Invalid recent source daily value");
    return [{ timestamp, value }];
  });
}

export function parseOnchainLabRows(payload) {
  if (payload?.key !== "mvrv_zscore" || !Array.isArray(payload.series) || !payload.series.length || payload.series.some(row => !Array.isArray(row) || row.length !== 2)) throw new Error("OnChainLab metric identity/series mismatch");
  const rows = recentRows(payload.series.map(row => row[0]), payload.series.map(row => row[1]));
  if (dailyTimestamp(payload.as_of) !== Math.max(...rows.map(row => row.timestamp))) throw new Error("OnChainLab source date mismatch");
  return rows;
}

function plotTraces(html) {
  if (typeof html !== "string" || html.length > 5000000) throw new Error("Invalid public chart size");
  const start = /Plotly\.newPlot\s*\(\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*/g.exec(html);
  const offset = start ? start.index + start[0].length : -1;
  if (offset < 0 || html[offset] !== "[") throw new Error("Public chart JSON traces not found");
  let depth = 0, quoted = false, escaped = false;
  for (let i = offset; i < html.length; i++) {
    const char = html[i];
    if (quoted) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return JSON.parse(html.slice(offset, i + 1));
  }
  throw new Error("Incomplete public chart JSON");
}

function floatValues(encoded) {
  if (Array.isArray(encoded)) return encoded;
  if (encoded?.dtype !== "f8" || typeof encoded.bdata !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded.bdata)) throw new Error("Unsupported chart value encoding");
  const binary = atob(encoded.bdata);
  if (!binary.length || binary.length % 8 || binary.length / 8 > 20000) throw new Error("Invalid float64 chart length");
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)), view = new DataView(bytes.buffer);
  return Array.from({ length: bytes.length / 8 }, (_, index) => view.getFloat64(index * 8, true));
}

export function parseChartRows(html, name, now = new Date()) {
  const matches = plotTraces(html).filter(trace => trace.name === name);
  if (matches.length !== 1) throw new Error("Public chart metric missing or ambiguous");
  const rows = recentRows(matches[0].x, floatValues(matches[0].y));
  if (rows.some(row => row.timestamp * 1000 > Math.floor(+now / 86400000) * 86400000)) throw new Error("Future public chart date");
  return rows;
}

export async function fetchFreeRows(source, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  if (![...Object.values(FREE_ONCHAIN), FREE_TMM].some(expected => sameFreeSource(source, expected))) throw new Error("Unknown free source");
  const response = await fetchImpl(source.endpoint, { method: "GET", signal: AbortSignal.timeout(20000), cache: "no-store" });
  if (!response.ok) throw new Error(`${source.label} HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 5000000) throw new Error("Public source response too large");
  return source.trace ? parseChartRows(body, source.trace, now) : parseOnchainLabRows(JSON.parse(body));
}
