#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { applyStrategyMnavDataset, STRATEGY_MNAV_FORMULA, STRATEGY_MNAV_METHODOLOGY_EFFECTIVE_DATE } from "../mnav-source.js";

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_FILE = path.join(SITE_DIR, "strategy-mnav.json");
const DASHBOARD_FILE = path.join(SITE_DIR, "dashboard.json");
const OFFICIAL_URL = "https://www.strategy.com/btc";

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
    classification: "Official latest disclosure; out-of-the-money claims remain senior claims"
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
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128 Safari/537.36", ...headers },
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return text;
}

async function fetchJson(url, options = {}) {
  return JSON.parse(await fetchText(url, { ...options, headers: { accept: "application/json", ...(options.headers || {}) } }));
}

async function firstProvider(providers, validate) {
  const errors = [];
  for (const provider of providers) {
    try {
      const value = await provider.load();
      if (!validate(value)) throw new Error("返回数据无效");
      return { ...value, source: provider.name, sourceUrl: provider.url };
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }
  throw new Error(errors.join("；") || "全部来源不可用");
}

async function fetchMstrQuote(fetchImpl) {
  return firstProvider([
    {
      name: "Nasdaq",
      url: "https://www.nasdaq.com/market-activity/stocks/mstr",
      load: async () => {
        const payload = await fetchJson("https://api.nasdaq.com/api/quote/MSTR/info?assetclass=stocks", {
          fetchImpl,
          headers: { referer: "https://www.nasdaq.com/" }
        });
        const quote = payload.data?.primaryData;
        return { price: numeric(quote?.lastSalePrice, "Nasdaq MSTR"), marketDate: isoDate(quote?.lastTradeTimestamp) };
      }
    },
    {
      name: "mNAV.com",
      url: "https://www.mnav.com/dashboard/strategy",
      load: async () => {
        const html = await fetchText("https://www.mnav.com/dashboard/strategy", { fetchImpl });
        const price = numeric(html.match(/\\?"latest\\?":\{\\?"sharePrice\\?":([\d.]+)/)?.[1], "mNAV.com MSTR");
        const preparedAt = html.match(/\\?"preparedAt\\?":\\?"([^"\\]+)"/)?.[1];
        return { price, marketDate: isoDate(preparedAt) };
      }
    },
    {
      name: "Yahoo Finance",
      url: "https://finance.yahoo.com/quote/MSTR/",
      load: async () => {
        const payload = await fetchJson("https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=5d&interval=1d", { fetchImpl });
        const meta = payload.chart?.result?.[0]?.meta;
        return { price: Number(meta?.regularMarketPrice), marketDate: isoDate(Number(meta?.regularMarketTime) * 1000) };
      }
    }
  ], (value) => Number.isFinite(value.price) && value.price > 1 && /^\d{4}-\d{2}-\d{2}$/.test(value.marketDate || ""));
}

async function fetchBtcQuote(fetchImpl) {
  return firstProvider([
    {
      name: "DefiLlama",
      url: "https://defillama.com/",
      load: async () => {
        const row = (await fetchJson("https://coins.llama.fi/prices/current/coingecko:bitcoin", { fetchImpl })).coins?.["coingecko:bitcoin"];
        return { price: Number(row?.price), fetchedAt: new Date(Number(row?.timestamp) * 1000).toISOString() };
      }
    },
    {
      name: "Coinbase",
      url: "https://www.coinbase.com/price/bitcoin",
      load: async () => {
        const row = await fetchJson("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { fetchImpl });
        return { price: Number(row.price), fetchedAt: row.time };
      }
    },
    {
      name: "Kraken",
      url: "https://www.kraken.com/prices/bitcoin",
      load: async () => {
        const payload = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", { fetchImpl });
        return { price: Number(Object.values(payload.result || {})[0]?.c?.[0]), fetchedAt: new Date().toISOString() };
      }
    }
  ], (value) => Number.isFinite(value.price) && value.price > 1_000 && Number.isFinite(Date.parse(value.fetchedAt)));
}

function rounded(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

export function calculateStrategyMnav({ basis, mstrQuote, btcQuote, now = new Date() }) {
  const classificationPrice = Number(basis.classificationPriceUsd);
  const maxDeviation = Number(basis.maxClassificationPriceDeviationPct || 0.2);
  if (Number.isFinite(classificationPrice)
    && Math.abs((mstrQuote.price / classificationPrice) - 1) > maxDeviation) {
    throw new Error("MSTR 股价已超出最近一次官方工具分类的安全校验范围，需重新读取官方 Net BPS");
  }
  const netReserveUsd = (basis.btcHoldings * btcQuote.price) + basis.usdAssetsUsd - basis.seniorClaimsUsd;
  if (netReserveUsd <= 0) throw new Error("Strategy Net Reserve 不为正数");
  const netBtcPerShareUsd = netReserveUsd / basis.fullyDilutedShares;
  const mnav = mstrQuote.price / netBtcPerShareUsd;
  return {
    schemaVersion: 1,
    status: "active",
    generatedAt: now.toISOString(),
    marketAsOf: mstrQuote.marketDate,
    basisAsOf: basis.asOf,
    mnav: rounded(mnav),
    formula: STRATEGY_MNAV_FORMULA,
    methodologyEffectiveDate: STRATEGY_MNAV_METHODOLOGY_EFFECTIVE_DATE,
    calculation: {
      mode: "official-methodology-estimate",
      note: "Latest market prices applied to Strategy's latest disclosed capital-structure basis"
    },
    inputs: {
      mstrPriceUsd: rounded(mstrQuote.price),
      btcPriceUsd: rounded(btcQuote.price),
      netBtcPerShareUsd: rounded(netBtcPerShareUsd),
      netBtc: rounded(netReserveUsd / btcQuote.price),
      btcHoldings: basis.btcHoldings,
      usdAssetsUsd: basis.usdAssetsUsd,
      seniorClaimsUsd: basis.seniorClaimsUsd,
      fullyDilutedShares: basis.fullyDilutedShares
    },
    validation: { activation: "active", formulaChecked: true, basisClassification: basis.classification },
    source: {
      label: "Strategy official methodology",
      url: OFFICIAL_URL,
      methodologyUrl: "https://www.strategy.com/notes"
    },
    marketSources: {
      mstr: { label: mstrQuote.source, url: mstrQuote.sourceUrl },
      btc: { label: btcQuote.source, url: btcQuote.sourceUrl, fetchedAt: btcQuote.fetchedAt }
    },
    basis: { ...basis }
  };
}

function officialDataset({ quote, basis, now }) {
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

export async function updateStrategyMnav({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const [previous, dashboard] = await Promise.all([
    readFile(OUTPUT_FILE, "utf8").then(JSON.parse),
    readFile(DASHBOARD_FILE, "utf8").then(JSON.parse)
  ]);
  let officialHtml = "";
  try { officialHtml = await fetchText(OFFICIAL_URL, { fetchImpl }); } catch {}

  let candidate;
  let basis = previous.basis;
  if (officialHtml) {
    try {
      const quote = parseOfficialLiveQuote(officialHtml);
      try { basis = parseOfficialBasis(officialHtml); } catch {}
      basis = {
        ...basis,
        classificationPriceUsd: quote.mstrPriceUsd,
        classificationVerifiedAt: quote.marketAsOf,
        maxClassificationPriceDeviationPct: 0.2
      };
      candidate = officialDataset({ quote, basis, now });
    } catch {}
  }
  if (!basis?.asOf) throw new Error("缺少最后有效的 Strategy 官方资本结构基准");
  if (!candidate) {
    const [mstrQuote, btcQuote] = await Promise.all([fetchMstrQuote(fetchImpl), fetchBtcQuote(fetchImpl)]);
    candidate = calculateStrategyMnav({ basis, mstrQuote, btcQuote, now });
  }
  if (previous?.mnav && Math.abs((candidate.mnav / previous.mnav) - 1) > 0.3) {
    throw new Error("Strategy mNAV 较上一快照跳变超过 30%");
  }
  const observationChanged = !sameObservation(previous, candidate);
  const effectiveDataset = observationChanged ? candidate : previous;
  const dashboardBefore = JSON.stringify(dashboard);
  applyStrategyMnavDataset(dashboard, effectiveDataset, { now });
  const dashboardChanged = JSON.stringify(dashboard) !== dashboardBefore;
  if (!observationChanged && !dashboardChanged) return { dataset: previous, changed: false };
  const writes = [];
  if (observationChanged) writes.push(writeFile(OUTPUT_FILE, `${JSON.stringify(candidate, null, 2)}\n`));
  if (dashboardChanged) writes.push(writeFile(DASHBOARD_FILE, `${JSON.stringify(dashboard, null, 2)}\n`));
  await Promise.all(writes);
  return { dataset: effectiveDataset, changed: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateStrategyMnav().then(({ dataset, changed }) => {
    console.log(changed
      ? `Strategy mNAV 自动快照已更新：${dataset.marketAsOf} · ${dataset.mnav.toFixed(2)}x · ${dataset.calculation.mode}`
      : "Strategy mNAV 自动快照没有变化。");
  }).catch((error) => {
    console.error(`Strategy mNAV 自动更新失败，保留最后有效数据：${error.message}`);
    process.exitCode = 1;
  });
}
