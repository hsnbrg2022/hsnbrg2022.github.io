import { normalizeEtfRows } from "../etf-core.js";
import { isTradingDay, validTradingDate } from "../trading-calendar.js";

const ENDPOINT = "https://universal-api.panewslab.com/search/articles";
const SOURCE = { label: "PANews / SoSoValue (rounded)", url: "https://www.panewslab.com/zh", method: "public-media" };

// Only the lead paragraph of a published daily report is eligible. Never parse
// headlines, related stories, individual funds, weekly totals or asset values.
export function parsePanewsEtf(article, now = new Date()) {
  if (article?.type !== "NEWS" || article.status !== "PUBLISHED" || article.lang !== "zh") return null;
  if (!/^[a-zA-Z0-9-]+$/.test(article.id || "")) return null;
  if (!/比特币现货\s*ETF.*(?:昨日|单日)/i.test(article.title || "")) return null;
  const published = new Date(article.publishedAt);
  if (!Number.isFinite(+published) || published > now) return null;
  const lead = (article.content?.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, "");
  if (!/SoSoValue数据/i.test(lead)) return null;
  const match = lead.match(/昨日[（(]美东时间(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日[）)]比特币现货ETF总净流(入|出)(\d+(?:\.\d+)?)(亿|万)美元/);
  if (!match) return null;
  const [, year, month, day, direction, amount, unit] = match;
  const years = year ? [Number(year)] : [published.getUTCFullYear(), published.getUTCFullYear() - 1];
  const dates = years.map(y => `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`)
    .filter(date => validTradingDate(date) && isTradingDay(date) === true &&
      +published >= Date.parse(`${date}T00:00:00Z`) && +published - Date.parse(`${date}T00:00:00Z`) <= 7 * 86400000);
  if (dates.length !== 1) return null;
  const flowUsdMillions = Number((Number(amount) * (unit === "亿" ? 100 : 0.01) * (direction === "出" ? -1 : 1)).toFixed(6));
  if (!Number.isFinite(flowUsdMillions) || Math.abs(flowUsdMillions) > 10000) return null;
  const updated = new Date(article.updatedAt || article.publishedAt);
  if (!Number.isFinite(+updated) || updated < published || updated > now) return null;
  return {
    date: dates[0], flowUsdMillions,
    origin: { method: "public-media", url: `https://www.panewslab.com/zh/articles/${article.id}`,
      publishedAt: published.toISOString(), revisedAt: updated.toISOString(),
      precisionUsdMillions: Number((10 ** -(amount.split(".")[1]?.length || 0) * (unit === "亿" ? 100 : 0.01)).toFixed(8)) }
  };
}

export async function loadPanewsEtf({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const reports = new Map();
  const seen = new Set();
  // Same public search used by the site's search UI. Six bounded pages allow
  // recovery beyond the 100-item general RSS window, without an account/key.
  for (let page = 0; page < 6; page++) {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json", "PA-Accept-Language": "zh" },
      body: JSON.stringify({ query: "SoSoValue", type: ["NEWS"], mode: "time", take: 20, skip: page * 20 })
    });
    if (!response.ok) throw new Error(`PANews HTTP ${response.status}`);
    const items = await response.json();
    if (!Array.isArray(items) || items.length > 20) throw new Error("PANews 搜索结构异常");
    let added = 0;
    for (const item of items) {
      const article = item?.article;
      if (!article?.id || seen.has(article.id)) continue;
      seen.add(article.id); added++;
      const report = parsePanewsEtf(article, now);
      if (!report) continue;
      const previous = reports.get(report.date);
      if (previous && previous.flowUsdMillions !== report.flowUsdMillions) throw new Error(`PANews ${report.date} 报道金额冲突，保留旧快照`);
      reports.set(report.date, report);
    }
    if (items.length === 20 && added === 0) throw new Error("PANews 分页重复，拒绝不完整采集");
    if (items.length < 20) break;
  }
  const rows = normalizeEtfRows([...reports.values()]);
  if (!rows.length) throw new Error("PANews 未返回可核验的 ETF 单日总流量");
  return { schemaVersion: 1, asset: "BTC", unit: "USD_MILLIONS", status: "snapshot",
    marketDate: rows.at(-1).date, generatedAt: now.toISOString(), source: { ...SOURCE, url: reports.get(rows.at(-1).date).origin.url },
    verificationSource: { label: "SoSoValue", url: "https://sosovalue.com/zh/assets/etf/us-btc-spot" }, rows,
    recordOrigins: Object.fromEntries([...reports].map(([date, report]) => [date, report.origin])) };
}

export function etfRecordOrigins(dataset) {
  if (dataset.recordOrigins) return structuredClone(dataset.recordOrigins);
  // Legacy manually maintained snapshots have no row-level provenance: protect
  // every existing row conservatively, not just their last trading day.
  return Object.fromEntries((dataset.rows || []).map(row => [row.date, {
    method: dataset.source?.method === "manual-entry" ? "manual-entry" : "legacy",
    url: dataset.source?.url || ""
  }]));
}

export function mergeEtfCollection(current, incoming) {
  if (validTradingDate(current.marketDate) && incoming.marketDate < current.marketDate) throw new Error("ETF 新数据早于现有数据，已拒绝回退");
  const rows = new Map(normalizeEtfRows(current.rows).map(row => [row.date, row]));
  const origins = etfRecordOrigins(current);
  let changed = false;
  for (const row of normalizeEtfRows(incoming.rows)) {
    const old = rows.get(row.date), origin = origins[row.date], next = incoming.recordOrigins?.[row.date] || incoming.source;
    if (origin?.method === "manual-entry") continue;
    if (old?.flowUsdMillions === row.flowUsdMillions) continue;
    if (old && incoming.source.method === "public-media") {
      if (origin?.method !== "public-media" || origin.url !== next.url || !(Date.parse(next.revisedAt) > Date.parse(origin.revisedAt))) {
        throw new Error(`ETF ${row.date} 更正依据不足，保留旧快照`);
      }
    }
    rows.set(row.date, row);
    origins[row.date] = { ...next, ...(old ? { previousFlowUsdMillions: old.flowUsdMillions } : {}) };
    changed = true;
  }
  if (!changed) return current; // A successful read must not refresh the data's timestamp.
  const outputRows = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  const latest = outputRows.at(-1).date;
  const retainSource = origins[latest]?.method === "manual-entry";
  return { ...current, ...incoming, source: retainSource ? current.source : incoming.source,
    marketDate: latest, rows: outputRows, recordOrigins: origins };
}
