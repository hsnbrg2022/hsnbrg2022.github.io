import { readFile, writeFile } from "node:fs/promises";
import { etfSignal, normalizeEtfRows } from "../etf-core.js";
import { validTradingDate } from "../trading-calendar.js";
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
  if (timestamp === null || timestamp === undefined || !Number.isFinite(value)) return null;
  const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function validDate(value) {
  return validTradingDate(value);
}

export function normalizeEtfPayload(payload, source = {}) {
  const inputRows = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.data?.list)
        ? payload.data.list
        : Array.isArray(payload?.result?.data)
          ? payload.result.data
          : [];
  const rows = inputRows.map((row) => {
    const date = validDate(row.date) ? row.date : isoDate(row.timestamp);
    const millionsValue = row.flowUsdMillions ?? row.flow_usd_millions;
    const usdValue = row.flow_usd ?? row.flowUsd ?? row.net_flow_usd ?? row.netFlowUsd;
    const directMillions = millionsValue === null || millionsValue === undefined || millionsValue === "" ? NaN : Number(millionsValue);
    const rawUsd = usdValue === null || usdValue === undefined || usdValue === "" ? NaN : Number(usdValue);
    const flowUsdMillions = Number.isFinite(directMillions) ? directMillions : rawUsd / 1_000_000;
    return { date, flowUsdMillions };
  });
  const normalized = normalizeEtfRows(rows).slice(-90);
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

export { summarizeEtfFlows } from "../etf-core.js";

export function applyEtfDataset(dashboard, dataset) {
  const target = dashboard.cards.find((item) => item.id === 1);
  if (!target) throw new Error("看板缺少 BTC ETF 卡片");
  Object.assign(target, etfSignal(dataset));
  target.source = { label: dataset.source.label, url: dataset.source.url };
  target.refresh = "auto";
  target.refreshStatus = "ok";
  target.refreshMessage = `ETF / ${dataset.source.label} · 截至 ${target.dataAsOf}`;
  target.marketFetchedAt = dataset.generatedAt;
  target.manualEntry = dataset.source?.method === "manual-entry";
  return dashboard;
}

async function fetchJson(url, options = {}) {
  const { fetchImpl = globalThis.fetch, ...requestOptions } = options;
  const response = await fetchImpl(url, {
    ...requestOptions,
    headers: { accept: "application/json", ...(requestOptions.headers || {}) }
  });
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
  return response.json();
}

export async function loadProviderDataset({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.ETF_FLOW_INPUT_PATH) {
    const payload = JSON.parse(await readFile(resolve(env.ETF_FLOW_INPUT_PATH), "utf8"));
    return normalizeEtfPayload(payload, payload.source || { label: "Fixture", method: "file" });
  }

  const providers = [];
  if (env.COINGLASS_API_KEY) {
    providers.push({
      label: "CoinGlass",
      load: async () => {
        const payload = await fetchJson(COINGLASS_ENDPOINT, {
          fetchImpl,
          headers: { "CG-API-KEY": env.COINGLASS_API_KEY }
        });
        return normalizeEtfPayload(payload, {
          label: "CoinGlass",
          url: "https://www.coinglass.com/bitcoin-etf",
          method: "official-api"
        });
      }
    });
  }
  if (env.ETF_FLOW_BACKUP_URL) {
    providers.push({
      label: env.ETF_FLOW_BACKUP_LABEL || "Backup ETF API",
      load: async () => {
        const headers = env.ETF_FLOW_BACKUP_KEY ? { authorization: `Bearer ${env.ETF_FLOW_BACKUP_KEY}` } : {};
        const payload = await fetchJson(env.ETF_FLOW_BACKUP_URL, { fetchImpl, headers });
        return normalizeEtfPayload(payload, {
          label: env.ETF_FLOW_BACKUP_LABEL || "Backup ETF API",
          url: env.ETF_FLOW_BACKUP_SOURCE_URL || env.ETF_FLOW_BACKUP_URL,
          method: "backup-api"
        });
      }
    });
  }
  if (!providers.length) {
    throw new Error("未配置 COINGLASS_API_KEY 或 ETF_FLOW_BACKUP_URL；Farside 会拦截服务器抓取，仅能作为人工复核来源");
  }

  const errors = [];
  for (const provider of providers) {
    try {
      return await provider.load();
    } catch (error) {
      errors.push(`${provider.label}: ${error.message}`);
    }
  }
  throw new Error(`ETF 数据源全部失败：${errors.join("；")}`);
}

async function main() {
  const dataset = await loadProviderDataset();
  const dashboard = JSON.parse(await readFile(DASHBOARD_FILE, "utf8"));
  const current = JSON.parse(await readFile(ETF_FILE, "utf8"));
  if (validDate(current.marketDate) && dataset.marketDate < current.marketDate) {
    throw new Error(`新数据 ${dataset.marketDate} 早于现有数据 ${current.marketDate}，已拒绝回退`);
  }
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
