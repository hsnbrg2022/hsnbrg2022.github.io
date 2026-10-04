import { normalizeEtfRows } from "../etf-core.js";
import { isTradingDay, validTradingDate, nextTradingDay } from "../trading-calendar.js";

const ENDPOINT = "https://universal-api.panewslab.com/search/articles";
const SOURCE = { label: "PANews / SoSoValue (rounded)", url: "https://www.panewslab.com/zh", method: "public-media" };
const DMR_URL = "https://www.dailymarket.report/index.html";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dmrDate(day, month, year) {
  const index = MONTHS.indexOf(month);
  const date = `${year}-${String(index + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  return index >= 0 && validTradingDate(date) ? date : null;
}

// DMR's public methodology identifies this dated "24h Flow" as the Farside
// daily total, not a rolling window. Never infer the trading day from publication.
export function parseDailyMarketEtf(html, now = new Date()) {
  if (typeof html !== "string" || html.length > 3_000_000 || !Number.isFinite(+now)) return null;
  const sections = [...html.matchAll(/<section\b[^>]*id="crypto-etfs"[^>]*>([\s\S]*?)<\/section>/g)];
  if (sections.length !== 1) return null;
  const section = sections[0][1];
  const refresh = section.match(/<span class="last-updated">Refreshed (\d{1,2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}) UTC/);
  if (!refresh) return null;
  const refreshedDate = dmrDate(refresh[1], refresh[2], refresh[3]);
  if (!refreshedDate || Number(refresh[4]) > 23 || Number(refresh[5]) > 59) return null;
  const revisedAt = `${refreshedDate}T${refresh[4]}:${refresh[5]}:00.000Z`;
  if (Date.parse(revisedAt) > +now || +now - Date.parse(revisedAt) > 7 * 86400000) return null;
  const blocks = section.split('<div class="etf-block">');
  if (blocks.length !== 2) return null;
  const block = blocks[1];
  if (!block.includes('<span class="title">Spot ETF Flows</span>') ||
    !block.includes('<span class="sub">Source: Farside Investors · AUM via FMP</span>')) return null;
  const cards = block.split('<div class="etf-card">').slice(1);
  const btc = cards.filter(card => /^\s*<div class="head">\s*<span class="ticker">BTC<\/span>/.test(card) ||
    /^\s*<span class="ticker">BTC<\/span>/.test(card));
  if (btc.length !== 1 || !/\b\d+ funds\b/.test(btc[0])) return null;
  const dates = [...btc[0].matchAll(/<span class="etf-funds-tt-foot">Flow data as of (\d{1,2}) ([A-Z][a-z]{2}) (\d{4})<\/span>/g)];
  const flows = [...btc[0].matchAll(/<span class="k">24h Flow<\/span>\s*<span class="v(?: pos| neg)?">([+−-]?)\$(\d+(?:\.\d+)?) ([MB])<\/span>/g)];
  if (dates.length !== 1 || flows.length !== 1) return null;
  const date = dmrDate(dates[0][1], dates[0][2], dates[0][3]);
  const nyParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", hourCycle:"h23" }).formatToParts(now);
  const ny = Object.fromEntries(nyParts.map(part => [part.type, part.value]));
  const nyToday = `${ny.year}-${ny.month}-${ny.day}`;
  if (!date || isTradingDay(date) !== true || date > nyToday || (date === nyToday && Number(ny.hour) < 16) ||
    Date.parse(`${date}T00:00:00Z`) > Date.parse(revisedAt) || +now - Date.parse(`${date}T00:00:00Z`) > 7 * 86400000) return null;
  const [, sign, amount, unit] = flows[0];
  if (!sign && Number(amount) !== 0) return null;
  const multiplier = unit === "B" ? 1000 : 1;
  const flowUsdMillions = Number((Number(amount) * multiplier * (["−", "-"].includes(sign) ? -1 : 1)).toFixed(6));
  if (!Number.isFinite(flowUsdMillions) || Math.abs(flowUsdMillions) > 10000) return null;
  return { date, flowUsdMillions, origin: { method:"public-media", url:DMR_URL, reportedSource:"Farside Investors",
    revisedAt, rounded:true, precisionUsdMillions:Number((multiplier * 10 ** -(amount.split(".")[1]?.length || 0)).toFixed(8)) } };
}

export async function loadDailyMarketEtf({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const response = await fetchImpl(DMR_URL, { method:"GET", redirect:"error", signal:AbortSignal.timeout(20000), headers:{accept:"text/html"} });
  if (!response.ok) throw new Error(`Daily Market Report HTTP ${response.status}`);
  const report = parseDailyMarketEtf(await response.text(), now);
  if (!report) throw new Error("Daily Market Report 未返回可核验的 BTC ETF 单日总流量");
  return { schemaVersion:1, asset:"BTC", unit:"USD_MILLIONS", status:"snapshot", marketDate:report.date,
    generatedAt:now.toISOString(), source:{label:"Daily Market Report / Farside (rounded)",url:DMR_URL,method:"public-media"},
    verificationSource:{label:"Farside",url:"https://farside.co.uk/btc/"},
    rows:[{date:report.date,flowUsdMillions:report.flowUsdMillions}], recordOrigins:{[report.date]:report.origin} };
}

export async function loadFreeEtf(options = {}) {
  const results = [], errors = [];
  // A readable old report is not enough: check the single-page free backup too.
  for (const load of [loadPanewsEtf, loadDailyMarketEtf]) {
    try { results.push(await load(options)); } catch (error) { errors.push(error.message); }
  }
  if (!results.length) throw new Error(`ETF 免费来源全部失败：${errors.join("；")}`);
  const rows = new Map(), origins = {};
  for (const result of results) for (const row of result.rows) {
    const previous = rows.get(row.date);
    if (previous && previous.flowUsdMillions !== row.flowUsdMillions) throw new Error(`ETF ${row.date} 免费来源金额冲突，保留旧快照`);
    if (!previous) { rows.set(row.date,row); origins[row.date] = result.recordOrigins[row.date]; }
  }
  const latest = results.reduce((a,b) => b.marketDate > a.marketDate ? b : a);
  return {...latest, rows:normalizeEtfRows([...rows.values()]), recordOrigins:origins};
}

// Only the lead paragraph of a published daily report is eligible. Never parse
// headlines, related stories, individual funds, weekly totals or asset values.
export function parsePanewsEtf(article, now = new Date()) {
  if (article?.type !== "NEWS" || article.status !== "PUBLISHED" || article.lang !== "zh") return null;
  if (!/^[a-zA-Z0-9-]+$/.test(article.id || "")) return null;
  if (!/(?:比特币现货\s*ETF.*(?:昨日|单日)|美国现货比特币\s*ETF净流[入出])/i.test(article.title || "")) return null;
  const published = new Date(article.publishedAt);
  if (!Number.isFinite(+published) || published > now) return null;
  const lead = (article.content?.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "")
    .replace(/<[^>]*>/g, "").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, "");
  const soso = /SoSoValue数据/i.test(lead) ? lead.match(/昨日[（(]美东时间(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日[）)]比特币现货ETF总净流(入|出)(\d+(?:\.\d+)?)(亿|万)美元/) : null;
  // Separately allow the verified The Block daily aggregate wording. Do not
  // relax to arbitrary media, individual funds, weekly totals or inferred dates.
  const block = lead.match(/据TheBlock统计[，,]美国现货比特币ETF于(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日合计净流(入|出)(\d+(?:\.\d+)?)(亿|万)美元(?=[，。,;；]|$)/i);
  if (!!soso === !!block) return null;
  const match = soso || block;
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
      publishedAt: published.toISOString(), revisedAt: updated.toISOString(), reportedSource: soso ? "SoSoValue" : "The Block",
      precisionUsdMillions: Number((10 ** -(amount.split(".")[1]?.length || 0) * (unit === "亿" ? 100 : 0.01)).toFixed(8)) }
  };
}

export async function loadPanewsEtf({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const reports = new Map();
  // Two attribution-independent searches, still at most six pages per run.
  // Dedupe across queries, but detect repeated pagination within each query.
  const seen = new Set();
  for (const query of ["SoSoValue", "比特币现货ETF"]) {
   const querySeen = new Set();
   for (let page = 0; page < 3; page++) {
    const response = await fetchImpl(ENDPOINT, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: { "content-type": "application/json", "PA-Accept-Language": "zh" },
      body: JSON.stringify({ query, type: ["NEWS"], mode: "time", take: 20, skip: page * 20 })
    });
    if (!response.ok) throw new Error(`PANews HTTP ${response.status}`);
    const items = await response.json();
    if (!Array.isArray(items) || items.length > 20) throw new Error("PANews 搜索结构异常");
    let added = 0;
    for (const item of items) {
      const article = item?.article;
      if (!article?.id || querySeen.has(article.id)) continue;
      querySeen.add(article.id); added++;
      if (seen.has(article.id)) continue;
      seen.add(article.id);
      const report = parsePanewsEtf(article, now);
      if (!report) continue;
      const previous = reports.get(report.date);
      if (previous && previous.flowUsdMillions !== report.flowUsdMillions) throw new Error(`PANews ${report.date} 报道金额冲突，保留旧快照`);
      reports.set(report.date, report);
    }
    if (items.length === 20 && added === 0) throw new Error("PANews 分页重复，拒绝不完整采集");
    if (items.length < 20) break;
   }
  }
  const rows = normalizeEtfRows([...reports.values()]);
  if (!rows.length) throw new Error("PANews 未返回可核验的 ETF 单日总流量");
  return { schemaVersion: 1, asset: "BTC", unit: "USD_MILLIONS", status: "snapshot",
    marketDate: rows.at(-1).date, generatedAt: now.toISOString(), source: { ...SOURCE,
      label: `PANews / ${reports.get(rows.at(-1).date).origin.reportedSource} (rounded)`, url: reports.get(rows.at(-1).date).origin.url },
    verificationSource: { label: "SoSoValue", url: "https://sosovalue.com/zh/assets/etf/us-btc-spot" }, rows,
    recordOrigins: Object.fromEntries([...reports].map(([date, report]) => [date, report.origin])) };
}

// Internal gaps only: a not-yet-published newest session is not assumed missing.
export function etfCompleteness(inputRows) {
  const rows = normalizeEtfRows(inputRows), missingDates = [];
  for (let i = 1; i < rows.length; i++) {
    let date = nextTradingDay(rows[i - 1].date), steps = 0;
    while (date && date < rows[i].date && steps++ < 1000) {
      missingDates.push(date);
      date = nextTradingDay(date);
    }
    if (!date || steps >= 1000) return { status: "calendar-unverified", missingDates };
  }
  return { status: missingDates.length ? "missing-trading-days" : "complete", missingDates };
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
