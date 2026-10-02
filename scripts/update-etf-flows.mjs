import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { etfSignal, normalizeEtfRows } from "../etf-core.js";
import { validTradingDate } from "../trading-calendar.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadPanewsEtf, mergeEtfCollection, etfCompleteness } from "./etf-media.mjs";
import { withWriteLock } from "./write-lock.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(SCRIPT_DIR, "..");
const ETF_FILE = resolve(SITE_DIR, "etf-flows.json");
const HEALTH_FILE = resolve(SITE_DIR, "etf-flows-health.json");
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
  providers.push({ label: "PANews", load: () => loadPanewsEtf({ fetchImpl }) });

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

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

export async function runEtfCollection({ env = process.env, fetchImpl = globalThis.fetch, now } = {}) {
  let incoming, failure, errorCode;
  try { incoming = await loadProviderDataset({ env, fetchImpl }); }
  catch (error) { failure = error; errorCode = "upstream_unavailable"; }
  const save = async () => {
    // File imports and fixtures are not evidence of an upstream collection.
    let previous;
    if (!env.ETF_FLOW_INPUT_PATH) {
      previous = JSON.parse(await readFile(HEALTH_FILE, "utf8"));
      const time = value => typeof value === "string" && Number.isFinite(Date.parse(value))
        && new Date(value).toISOString() === value && Date.parse(value) <= (now ?? new Date()).getTime();
      const initial = previous.status === "unknown" && previous.checkedAt === null && previous.lastSuccessAt === null;
      const recorded = ["ok", "failed"].includes(previous.status) && time(previous.checkedAt)
        && (previous.lastSuccessAt === null || time(previous.lastSuccessAt) && previous.lastSuccessAt <= previous.checkedAt)
        && (previous.status !== "ok" || previous.lastSuccessAt === previous.checkedAt);
      if (previous.schemaVersion !== 1 || previous.collector !== "etf-flows" || (!initial && !recorded)) throw new Error("ETF 后台运行记录无效，停止覆盖，请核查记录");
    }
    let result;
    try {
      if (failure) throw failure;
      const current = JSON.parse(await readFile(ETF_FILE, "utf8"));
      let dataset;
      try {
        dataset = mergeEtfCollection(current, incoming);
        etfSignal(dataset);
      } catch (error) { errorCode = "validation_failed"; throw error; }
      const changed = dataset !== current;
      if (changed) await writeJsonAtomic(ETF_FILE, dataset);
      result = { dataset, changed, completeness: etfCompleteness(dataset.rows) };
    } catch (error) { failure = error; }
    if (previous) {
      const checkedAt = (now ?? new Date()).toISOString();
      await writeJsonAtomic(HEALTH_FILE, {
        schemaVersion: 1, collector: "etf-flows",
        execution: env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
        checkedAt, status: failure ? "failed" : "ok",
        lastSuccessAt: failure ? previous.lastSuccessAt : checkedAt,
        snapshotChanged: failure ? null : result.changed,
        // Fixed codes only: no provider URLs, labels, keys or exception text.
        errorCode: failure ? errorCode || "collector_failed" : null,
        // Success means readable, not complete. Failure leaves coverage unknown.
        completeness: failure ? null : result.completeness
      });
    }
    if (failure) throw failure;
    return result;
  };
  if (env.GITHUB_ACTIONS === "true") return save();
  return withWriteLock(resolve(SITE_DIR, "../crypto-dashboard/.dashboard-write.lock"), save);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runEtfCollection().then(({ dataset, changed, completeness }) => {
    console.log(changed ? `ETF 数据已更新至 ${dataset.marketDate}，来源 ${dataset.source.label}。`
      : `ETF 无新增或可核验更正，保留 ${dataset.marketDate} 快照。`);
    if (completeness.status === "missing-trading-days") console.warn(`ETF 采集成功但存在缺少交易日：${completeness.missingDates.join("、")}；不得跨缺口累计。`);
    else if (completeness.status === "calendar-unverified") console.warn("ETF 采集成功，但交易日完整性待核验。");
    else console.log("ETF 已记录区间内无缺少交易日（不保证最新交易日已公布）。");
  }).catch((error) => {
    console.error(`ETF 更新失败：${error.message}`);
    process.exitCode = 1;
  });
}
