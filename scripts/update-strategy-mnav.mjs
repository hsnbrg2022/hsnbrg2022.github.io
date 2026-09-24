#!/usr/bin/env node

import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateStrategyMnavDataset, strategyMnavBusinessDaysSince, STRATEGY_MNAV_FORMULA, STRATEGY_MNAV_METHODOLOGY_EFFECTIVE_DATE } from "../mnav-source.js";
import { withWriteLock } from "./write-lock.mjs";

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_FILE = path.join(SITE_DIR, "strategy-mnav.json");
const HEALTH_FILE = path.join(SITE_DIR, "strategy-mnav-health.json");
const OFFICIAL_URL = "https://www.strategy.com/btc";
export const MSTR_API = "https://api.strategy.com/btc/mstrKpiData";
export const BTC_API = "https://api.strategy.com/btc/bitcoinKpis";

export function parseOfficialApiQuote(mstrPayload, btcPayload, { now = new Date() } = {}) {
  const stocks = Array.isArray(mstrPayload) ? mstrPayload.filter(row => row.company === "MSTR") : [];
  if (stocks.length !== 1) throw new Error("官方 MSTR 行情记录无效");
  const stock = stocks[0], btc = btcPayload?.results;
  const timestamp = (value, label) => {
    if (!Number.isSafeInteger(value) || value <= 0 || value > now.getTime()) throw new Error(`官方 ${label} 时间无效`);
    return new Date(value).toISOString();
  };
  const mstrObservedAt = timestamp(stock.msTimeStamp, "MSTR");
  const btcObservedAt = timestamp(btc?.msTimestamp, "BTC");
  const marketDate = value => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(value));
  const marketAsOf = marketDate(mstrObservedAt);
  // BTC trades around the clock, MSTR does not. Keep both observations rather
  // than relabelling the last stock trade with today's BTC timestamp.
  for (const date of [marketAsOf, marketDate(btcObservedAt)]) {
    if (strategyMnavBusinessDaysSince(date, now) > 2) throw new Error("官方行情已滞后超过 2 个交易日");
  }
  const positive = (value, label) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new Error(`官方 ${label} 无效`);
    return value;
  };
  // Use only the regular-session fields; never mix in extendedSession quotes.
  return {
    mnav: positive(btc.mNav, "mNAV"),
    mstrPriceUsd: positive(stock.ufPrice, "MSTR 价格"),
    netBtcPerShareUsd: positive(btc.netBtcPerShareUsd, "Net BPS"),
    btcPriceUsd: positive(btc.ufPrice, "BTC 价格"),
    netBtc: null, marketAsOf, mstrObservedAt, btcObservedAt
  };
}

function unescapeHtml(value) {
  return String(value)
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
}

function numeric(value, label) {
  const parsed = Number(String(value).replace(/[$,%₿x,()]/g, "").trim());
  if (!Number.isFinite(parsed)) throw new Error(`${label} 无效`);
  return parsed;
}

function isoDate(value) {
  const text = String(value || "");
  const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  const namedDate = text.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
  if (namedDate) {
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
      .indexOf(namedDate[1].slice(0, 1).toUpperCase() + namedDate[1].slice(1).toLowerCase()) + 1;
    if (month > 0) return `${namedDate[3]}-${String(month).padStart(2, "0")}-${namedDate[2].padStart(2, "0")}`;
  }
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString().slice(0, 10) : null;
}

function nextDataFromHtml(html) {
  const match = String(html).match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  return JSON.parse(unescapeHtml(match[1]));
}

export function parseOfficialBasis(html) {
  const nextData = nextDataFromHtml(html);
  const rows = nextData?.props?.pageProps?.btcTrackerData;
  if (!Array.isArray(rows) || !rows.length) throw new Error("Strategy 官方资本结构未找到");
  const row = rows.find((item) => item.latest) || rows.at(-1);
  const btcHoldings = numeric(row.btc_holdings, "BTC 持仓");
  const basicShares = numeric(row.basic_shares_outstanding, "基本股数");
  const options = numeric(row.shares?.options_outstanding || 0, "期权股数");
  const awards = numeric(row.shares?.rsu_psu_unvested || 0, "股权奖励股数");
  return {
    asOf: isoDate(row.as_of_date),
    btcHoldings,
    usdAssetsUsd: numeric(row.cash, "USD Reserve") + numeric(row.operating_cash, "Operating Cash"),
    seniorClaimsUsd: numeric(row.debt, "Debt") + numeric(row.pref, "Preferred"),
    fullyDilutedShares: basicShares + options + awards,
    classification: "Unverified: aggregate balances do not identify convertible instruments"
  };
}

function renderedMetric(html, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`>${escaped}<\\/span>[\\s\\S]{0,900}?numberGridLargeValue[^>]*>([^<]+)<`, "i"),
    new RegExp(`${escaped}\\s*(?:\\r?\\n|<[^>]+>)+\\s*([^\\r\\n<]+)`, "i")
  ];
  for (const pattern of patterns) {
    const match = String(html).match(pattern);
    if (match) return match[1];
  }
  throw new Error(`Strategy 官方字段 ${label} 未找到`);
}

export function parseOfficialLiveQuote(html) {
  const mnav = numeric(renderedMetric(html, "mNAV"), "官方 mNAV");
  const mstrPriceUsd = numeric(renderedMetric(html, "MSTR Price"), "官方 MSTR 价格");
  const netBtcPerShareUsd = numeric(renderedMetric(html, "Net BTC Per Share ($)"), "官方 Net BPS");
  const btcPriceUsd = numeric(renderedMetric(html, "Bitcoin Price"), "官方 BTC 价格");
  const netBtc = numeric(renderedMetric(html, "Net BTC"), "官方 Net BTC");
  const timestamp = String(html).match(/Securities market data last updated:\s*([^;<\n]+?ET)/i)?.[1];
  const dateText = timestamp?.match(/\d{2}\/\d{2}\/\d{4}/)?.[0];
  const marketAsOf = dateText
    ? `${dateText.slice(6)}-${dateText.slice(0, 2)}-${dateText.slice(3, 5)}`
    : null;
  if (!marketAsOf) throw new Error("Strategy 官方行情日期未找到");
  return { mnav, mstrPriceUsd, netBtcPerShareUsd, btcPriceUsd, netBtc, marketAsOf };
}

async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 10_000, headers = {} } = {}) {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return text;
}

function rounded(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

export function calculateStrategyMnav() {
  throw new Error("Strategy mNAV: mnavClassificationUnknown; convertible instruments are not verified; previous value retained");
}

export function officialDataset({ quote, basis, now }) {
  return {
    schemaVersion: 1,
    status: "active",
    generatedAt: now.toISOString(),
    marketAsOf: quote.marketAsOf,
    basisAsOf: basis.asOf,
    mnav: rounded(quote.mnav),
    formula: STRATEGY_MNAV_FORMULA,
    methodologyEffectiveDate: STRATEGY_MNAV_METHODOLOGY_EFFECTIVE_DATE,
    calculation: { mode: "official-live", note: "Values read directly from Strategy's official dashboard" },
    inputs: {
      mstrPriceUsd: rounded(quote.mstrPriceUsd),
      btcPriceUsd: rounded(quote.btcPriceUsd),
      netBtcPerShareUsd: rounded(quote.netBtcPerShareUsd),
      netBtc: rounded(quote.netBtc),
      btcHoldings: basis.btcHoldings,
      usdAssetsUsd: basis.usdAssetsUsd,
      seniorClaimsUsd: basis.seniorClaimsUsd,
      fullyDilutedShares: basis.fullyDilutedShares
    },
    validation: { activation: "active", formulaChecked: true, basisClassification: basis.classification },
    source: { label: "Strategy official dashboard", url: OFFICIAL_URL, methodologyUrl: "https://www.strategy.com/notes" },
    marketSources: { mstr: { label: "Strategy / Nasdaq", url: OFFICIAL_URL }, btc: { label: "Strategy / Coinbase", url: OFFICIAL_URL } },
    basis: { ...basis }
  };
}

function sameObservation(left, right) {
  return Boolean(left && right)
    && left.marketAsOf === right.marketAsOf
    && left.basisAsOf === right.basisAsOf
    && left.mnav === right.mnav
    && left.inputs?.mstrPriceUsd === right.inputs?.mstrPriceUsd
    && left.inputs?.btcPriceUsd === right.inputs?.btcPriceUsd
    && left.inputs?.netBtcPerShareUsd === right.inputs?.netBtcPerShareUsd
    && left.calculation?.mode === right.calculation?.mode;
}

export async function updateStrategyMnav({ fetchImpl = globalThis.fetch, now } = {}) {
  const previous = JSON.parse(await readFile(OUTPUT_FILE, "utf8"));
  let payloads;
  try {
    payloads = await Promise.all([MSTR_API, BTC_API].map(async url => JSON.parse(await fetchText(url, { fetchImpl }))));
  } catch (error) {
    throw Object.assign(new Error(`Strategy 官方 API 请求失败：${error.message}`, { cause: error }), { healthCode: "upstream_request_failed" });
  }
  let quote;
  now ??= new Date();
  try {
    quote = parseOfficialApiQuote(...payloads, { now });
  } catch (error) {
    // Preserve the actual failure instead of misreporting a classification issue.
    // Missing official values must not activate the unverified estimate.
    throw Object.assign(new Error(`Strategy 官方行情解析失败：${error.message}；未启用估算`, { cause: error }), { healthCode: "invalid_official_quote" });
  }
  // API quote timestamps say nothing about the age/completeness of capital data.
  const basis = previous.basis || {};
  const candidate = officialDataset({ quote, basis, now });
  candidate.basisAsOf = basis.asOf || null;
  candidate.basisComplete = false;
  candidate.observations = { mstr: quote.mstrObservedAt, btc: quote.btcObservedAt };
  candidate.inputs.netBtc = null;
  candidate.source.apiUrls = [MSTR_API, BTC_API];
  candidate.calculation.note = "Direct official API readings; capital information retained separately and unverified";
  if (previous?.mnav && Math.abs((candidate.mnav / previous.mnav) - 1) > 0.3) {
    throw Object.assign(new Error("Strategy mNAV 较上一快照跳变超过 30%"), { healthCode: "validation_failed" });
  }
  const observationChanged = !sameObservation(previous, candidate)
    || previous.basisComplete !== candidate.basisComplete
    || JSON.stringify(previous.observations) !== JSON.stringify(candidate.observations);
  const effectiveDataset = observationChanged ? candidate : previous;
  try { validateStrategyMnavDataset(effectiveDataset, { now }); }
  catch (error) { throw Object.assign(error, { healthCode: "validation_failed" }); }
  if (!observationChanged) return { dataset: previous, changed: false };
  await writeJsonAtomic(OUTPUT_FILE, candidate);
  return { dataset: effectiveDataset, changed: true };
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}

// Only the actual collector records backend health. Reading a cached snapshot
// must never call this entry point or refresh these timestamps.
export async function runStrategyMnav(options = {}) {
  const run = async () => {
    const previous = JSON.parse(await readFile(HEALTH_FILE, "utf8"));
    const before = options.now ?? new Date();
    const validTime = value => typeof value === "string" && Number.isFinite(Date.parse(value))
      && new Date(value).toISOString() === value && Date.parse(value) <= before.getTime();
    const initial = previous.status === "unknown" && previous.checkedAt === null && previous.lastSuccessAt === null;
    const recorded = ["ok", "failed"].includes(previous.status) && validTime(previous.checkedAt)
      && (previous.lastSuccessAt === null || validTime(previous.lastSuccessAt) && previous.lastSuccessAt <= previous.checkedAt)
      && (previous.status !== "ok" || previous.lastSuccessAt === previous.checkedAt);
    if (previous.schemaVersion !== 1 || previous.collector !== "strategy-mnav" || (!initial && !recorded)) {
      throw new Error("mNAV 后台运行记录无效，停止覆盖，请核查记录");
    }
    let result, failure;
    try { result = await updateStrategyMnav(options); }
    catch (error) { failure = error; }
    const checkedAt = (options.now ?? new Date()).toISOString();
    const knownCodes = ["upstream_request_failed", "invalid_official_quote", "validation_failed"];
    await writeJsonAtomic(HEALTH_FILE, {
      schemaVersion: 1,
      collector: "strategy-mnav",
      execution: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
      checkedAt,
      status: failure ? "failed" : "ok",
      lastSuccessAt: failure ? previous.lastSuccessAt : checkedAt,
      snapshotChanged: failure ? null : result.changed,
      // Never publish exception text, response bodies, stack traces or credentials.
      errorCode: failure ? (knownCodes.includes(failure.healthCode) ? failure.healthCode : "collector_failed") : null
    });
    if (failure) throw failure;
    return result;
  };
  // Actions already serializes this collector. Local runs share the publisher's lock.
  return process.env.GITHUB_ACTIONS === "true" ? run()
    : withWriteLock(path.resolve(SITE_DIR, "../crypto-dashboard/.dashboard-write.lock"), run);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runStrategyMnav().then(({ dataset, changed }) => {
    console.log(changed
      ? `Strategy mNAV 自动快照已更新：${dataset.marketAsOf} · ${dataset.mnav.toFixed(2)}x · ${dataset.calculation.mode}`
      : "Strategy mNAV 自动快照没有变化。");
  }).catch((error) => {
    console.error(`Strategy mNAV 自动更新失败，保留最后有效数据：${error.message}`);
    process.exitCode = 1;
  });
}
