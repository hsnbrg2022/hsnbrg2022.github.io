import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(SCRIPT_DIR, "..");
const ETF_FILE = resolve(SITE_DIR, "etf-flows.json");
const DASHBOARD_FILE = resolve(SITE_DIR, "dashboard.json");
const COINGLASS_ENDPOINT = "https://open-api-v4.coinglass.com/api/etf/bitcoin/flow-history";
const FARSIDE_URL = "https://farside.co.uk/btc/";

function isoDate(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value)) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

export function normalizeEtfPayload(payload, source = {}) {
  const inputRows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.data) ? payload.data : [];
  const rows = inputRows.map((row) => {
    const date = validDate(row.date) ? row.date : isoDate(row.timestamp);
    const flowUsdMillions = Number.isFinite(Number(row.flowUsdMillions))
      ? Number(row.flowUsdMillions)
      : Number(row.flow_usd) / 1_000_000;
    return { date, flowUsdMillions };
  }).filter((row) => validDate(row.date) && Number.isFinite(row.flowUsdMillions));
  const unique = new Map(rows.map((row) => [row.date, row]));
  const normalized = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  if (!normalized.length) throw new Error("ETF 数据源没有返回有效交易日记录");
  return {
    schemaVersion: 1,
    asset: "BTC",
    unit: "USD_MILLIONS",
    status: "live",
    marketDate: normalized.at(-1).date,
    generatedAt: new Date().toISOString(),
    source: {
      label: source.label || payload?.source?.label || "ETF data provider",
      url: source.url || payload?.source?.url || "",
      method: source.method || payload?.source?.method || "api"
    },
    verificationSource: { label: "Farside", url: FARSIDE_URL },
    rows: normalized
  };
}

function signedMillions(value) {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`;
}

function cumulativeLabel(value) {
  const sign = value < 0 ? "−" : "";
  const absolute = Math.abs(value);
  if (absolute >= 1000) return `${sign}$${(absolute / 1000).toFixed(1)}B`;
  return `${sign}$${absolute.toFixed(1)}M`;
}

export function summarizeEtfFlows(rows) {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return null;
  const latest = sorted.at(-1);
  const direction = latest.flowUsdMillions > 0 ? "inflow" : latest.flowUsdMillions < 0 ? "outflow" : "flat";
  let streak = 0;
  let cumulative = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const value = Number(sorted[index].flowUsdMillions);
    if ((direction === "inflow" && value <= 0) || (direction === "outflow" && value >= 0) || direction === "flat") break;
    streak += 1;
    cumulative += value;
  }
  return { latest, direction, streak, cumulative, recent: sorted.slice(-4) };
}

export function applyEtfDataset(dashboard, dataset) {
  const summary = summarizeEtfFlows(dataset.rows);
  const target = dashboard.cards.find((item) => item.id === 1);
  if (!summary || !target) throw new Error("看板缺少 BTC ETF 卡片或有效 ETF 数据");
  const directionText = summary.direction === "inflow" ? "净流入" : summary.direction === "outflow" ? "净流出" : "净流量持平";
  target.headline = summary.direction === "flat"
    ? `最新交易日净流量持平`
    : `连续 ${summary.streak} 日${directionText} · 累计 ${cumulativeLabel(summary.cumulative)}`;
  target.facts = summary.recent.map((row) => {
    const [, month, day] = row.date.split("-");
    return `${Number(month)}/${Number(day)} ${signedMillions(row.flowUsdMillions)}`;
  });
  target.detail = summary.direction === "inflow"
    ? `ETF 资金连续净流入，机构配置需求保持支撑。`
    : summary.direction === "outflow"
      ? `ETF 资金连续净流出，机构配置需求转弱。`
      : `最新交易日 ETF 资金净流量持平。`;
  target.status = summary.direction === "inflow" && summary.streak >= 2
    ? "green"
    : summary.direction === "outflow" && summary.streak >= 3 ? "red" : "yellow";
  target.change = summary.direction === "flat" ? "最新交易日持平" : `连续${summary.streak}日${directionText}`;
  target.source = { label: dataset.source.label, url: dataset.source.url };
  target.refresh = "auto";
  target.refreshStatus = "ok";
  target.refreshMessage = `ETF / ${dataset.source.label} · 截至 ${dataset.marketDate}`;
  target.dataAsOf = dataset.marketDate;
  target.marketFetchedAt = dataset.generatedAt;
  return dashboard;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { accept: "application/json", ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
  return response.json();
}

async function loadProviderDataset() {
  if (process.env.ETF_FLOW_INPUT_PATH) {
    const payload = JSON.parse(await readFile(resolve(process.env.ETF_FLOW_INPUT_PATH), "utf8"));
    return normalizeEtfPayload(payload, payload.source || { label: "Fixture", method: "file" });
  }
  if (process.env.COINGLASS_API_KEY) {
    const payload = await fetchJson(COINGLASS_ENDPOINT, { headers: { "CG-API-KEY": process.env.COINGLASS_API_KEY } });
    return normalizeEtfPayload(payload, {
      label: "CoinGlass",
      url: "https://www.coinglass.com/bitcoin-etf",
      method: "official-api"
    });
  }
  if (process.env.ETF_FLOW_BACKUP_URL) {
    const headers = process.env.ETF_FLOW_BACKUP_KEY ? { authorization: `Bearer ${process.env.ETF_FLOW_BACKUP_KEY}` } : {};
    const payload = await fetchJson(process.env.ETF_FLOW_BACKUP_URL, { headers });
    return normalizeEtfPayload(payload, {
      label: process.env.ETF_FLOW_BACKUP_LABEL || "Backup ETF API",
      url: process.env.ETF_FLOW_BACKUP_SOURCE_URL || process.env.ETF_FLOW_BACKUP_URL,
      method: "backup-api"
    });
  }
  return null;
}

async function main() {
  const dataset = await loadProviderDataset();
  if (!dataset) {
    console.log("未配置 COINGLASS_API_KEY 或 ETF_FLOW_BACKUP_URL；保留最近 ETF 快照。Farside 仅用于人工复核。" );
    return;
  }
  const dashboard = JSON.parse(await readFile(DASHBOARD_FILE, "utf8"));
  applyEtfDataset(dashboard, dataset);
  await writeFile(ETF_FILE, `${JSON.stringify(dataset, null, 2)}\n`);
  await writeFile(DASHBOARD_FILE, `${JSON.stringify(dashboard, null, 2)}\n`);
  console.log(`ETF 数据已更新至 ${dataset.marketDate}，来源 ${dataset.source.label}。`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`ETF 更新失败：${error.message}`);
    process.exitCode = 1;
  });
}
