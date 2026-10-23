import { calculateDxyFromRates, applyBtcChange } from "./model.js?v=20261023-gold";
import { BTC_MAX_AGE_MS, btcObservationTimestamp } from "./data-quality.js?v=20261023-gold";
import { updateStablecoins as refreshStablecoins } from "./stablecoin-source.js?v=20260909-1";
import { etfSignal } from "./etf-core.js?v=20260905-3";
import { readEtfHealth } from "./etf-health.js?v=20261003-health";
import { tradingDaysSince } from "./trading-calendar.js";
import { updateWeeklyMean } from "./weekly-mean.js?v=20260905-3";
import { applyFedDatasetToDashboard } from "./fed-signals.js?v=20260829-1";
import { updateTrueMarketMeanFromSnapshot } from "./true-market-mean.js?v=20261004-onchain";
import { updateMnavFromSnapshot } from "./mnav-source.js?v=20260925-health";
import { updateOnchainFromSnapshot } from "./onchain-source.js?v=20261004-onchain";
import { applyMacroQuote } from "./macro-quote.js?v=20261023-gold";

const REQUEST_TIMEOUT_MS = 10_000;

function card(data, id) {
  return data.cards.find((item) => item.id === id);
}

function cloneDashboard(data) {
  return typeof structuredClone === "function"
    ? structuredClone(data)
    : JSON.parse(JSON.stringify(data));
}

export { tradingDaysSince as etfWeekdaysSince } from "./trading-calendar.js";

export function applyEtfDatasetToDashboard(data, dataset, { now = new Date() } = {}) {
  if (dataset.asset !== "BTC" || dataset.unit !== "USD_MILLIONS") throw new Error("ETF 数据文件无效");
  const target = card(data, 1);
  Object.assign(target, etfSignal(dataset, { now }));
  target.source = { label: dataset.source?.label || "ETF data", url: dataset.source?.url || "https://farside.co.uk/btc/" };
  target.refresh = "auto";
  target.marketFetchedAt = dataset.generatedAt || null;
  target.etfSnapshotAt = dataset.generatedAt || null;
  target.manualEntry = dataset.source?.method === "manual-entry";
  const age = tradingDaysSince(target.dataAsOf, now);
  target.refreshStatus = age > 2 ? "stale" : dataset.status === "live" ? "ok" : "snapshot";
  target.refreshMessage = `ETF / ${target.source.label} · 截至 ${target.dataAsOf}`;
  return target.refreshStatus === "stale" ? `ETF 数据可能滞后 / ${target.source.label}` : target.refreshStatus === "snapshot" ? `ETF 发布快照 / ${target.source.label}` : `ETF / ${target.source.label}`;
}

export async function updateEtf(data, fetchImpl, onDataset) {
  const healthRead = readEtfHealth(data, fetchImpl);
  try {
  // Bot commits do not trigger a Pages build. Read the public repository data
  // directly as well as the deployed copy, without any token in the browser.
  const paths = ["https://raw.githubusercontent.com/hsnbrg2022/hsnbrg2022.github.io/main/etf-flows.json", "./etf-flows.json"];
  const candidates = await Promise.allSettled(paths.map(async path => {
    const snapshot = await fetchJson(`${path}?v=${Date.now()}`, fetchImpl);
    applyEtfDatasetToDashboard(structuredClone(data), snapshot);
    return snapshot;
  }));
  const valid = candidates.filter(result => result.status === "fulfilled").map(result => result.value)
    .sort((a, b) => String(b.marketDate || b.rows.at(-1).date).localeCompare(String(a.marketDate || a.rows.at(-1).date)) ||
      (Date.parse(b.generatedAt) || 0) - (Date.parse(a.generatedAt) || 0));
  if (!valid.length) throw new Error("ETF snapshots unavailable / ETF 快照暂不可用");
  const dataset = valid[0];
  const message = applyEtfDatasetToDashboard(data, dataset);
  onDataset(dataset);
  card(data, 1).etfReadCheck = { checkedAt: new Date().toISOString(), status: "ok" };
  return message;
  } catch (error) {
    const target = card(data, 1);
    if (target) target.etfReadCheck = { checkedAt: new Date().toISOString(), status: "failed" };
    throw error;
  } finally { await healthRead; }
}

async function updateFed(data, fetchImpl) {
  const dataset = await fetchJson(`./fed-signals.json?v=${Date.now()}`, fetchImpl);
  return applyFedDatasetToDashboard(data, dataset);
}

async function updateTrueMarketMean(data, fetchImpl) {
  return updateTrueMarketMeanFromSnapshot(data, fetchImpl);
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
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
  throw new Error(errors.join("；") || "全部数据源不可用");
}

// Keep local and browser BTC fallback order identical, regardless of response speed.
export function selectBtcQuote(providers, market = {}) {
  const ordered = ["DefiLlama", "CoinGecko", "Coinbase", "Kraken", "Yahoo Finance"]
    .map(name => providers.find(provider => provider.name === name)).filter(Boolean);
  return firstProvider(ordered, value => {
    const now = Date.now();
    const previous = btcObservationTimestamp(market.btcObservedAt);
    return value.currency === "USD" && Number.isFinite(value.price) && value.price > 0 && Number.isFinite(value.change)
      && Number.isSafeInteger(value.timestamp) && now - value.timestamp >= 0 && now - value.timestamp <= BTC_MAX_AGE_MS
      && (!Number.isFinite(previous) || previous > now || value.timestamp >= previous);
  });
}

async function updateBtc(data, fetchImpl) {
  const asset = "coingecko:bitcoin";
  const previousTimestamp = Math.floor(Date.now() / 1000) - 86_400;
  const quote = await selectBtcQuote([
    {
      name: "DefiLlama",
      url: "https://defillama.com/",
      load: async () => {
        const [currentPayload, previousPayload] = await Promise.all([
          fetchJson(`https://coins.llama.fi/prices/current/${asset}`, fetchImpl),
          fetchJson(`https://coins.llama.fi/prices/historical/${previousTimestamp}/${asset}`, fetchImpl)
        ]);
        const current = currentPayload.coins?.[asset];
        const previous = previousPayload.coins?.[asset];
        const price = Number(current?.price);
        const previousPrice = Number(previous?.price);
        return { price, currency: "USD", change: ((price / previousPrice) - 1) * 100, timestamp: Number(current?.timestamp) * 1000,
          changeBasis: Number(current?.timestamp) - Number(previous?.timestamp) === 86400 ? "rolling24h" : "historical" };
      }
    },
    {
      name: "CoinGecko",
      url: "https://www.coingecko.com/en/coins/bitcoin",
      load: async () => {
        const payload = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true", fetchImpl);
        return { price: Number(payload.bitcoin?.usd), currency: "USD", timestamp: Number(payload.bitcoin?.last_updated_at) * 1000, change: typeof payload.bitcoin?.usd_24h_change === "number" ? payload.bitcoin.usd_24h_change : NaN, changeBasis: "rolling24h" };
      }
    },
    {
      name: "Coinbase",
      url: "https://www.coinbase.com/price/bitcoin",
      load: async () => {
        const [ticker, stats] = await Promise.all([
          fetchJson("https://api.exchange.coinbase.com/products/BTC-USD/ticker", fetchImpl),
          fetchJson("https://api.exchange.coinbase.com/products/BTC-USD/stats", fetchImpl)
        ]);
        const price = Number(ticker.price);
        const open = Number(stats.open);
        const last = Number(stats.last);
        return { price, currency: "USD", timestamp: btcObservationTimestamp(ticker.time), change: Number.isFinite(last) && last > 0 && Number.isFinite(open) && open > 0 ? ((last / open) - 1) * 100 : NaN, changeBasis: "rolling24h" };
      }
    },
    {
      name: "Kraken",
      url: "https://www.kraken.com/prices/bitcoin",
      load: async () => {
        const [payload, trades] = await Promise.all([
          fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", fetchImpl),
          fetchJson("https://api.kraken.com/0/public/Trades?pair=XBTUSD&count=1", fetchImpl)
        ]);
        const ticker = payload.result?.XXBTZUSD;
        const trade = trades.result?.XXBTZUSD?.at(-1);
        const price = Number(trade?.[0]);
        const open = Number(ticker?.o);
        return { price, currency: "USD", timestamp: Math.floor(Number(trade?.[2]) * 1000), change: ((price / open) - 1) * 100, changeBasis: "utc-open" };
      }
    }
  ], data.market);

  data.market.btcPrice = quote.price;
  data.market.btcCurrency = quote.currency;
  applyBtcChange(data.market, quote);
  data.market.btcSource = quote.source;
  data.market.btcObservedAt = new Date(quote.timestamp).toISOString();
  data.market.btcFetchedAt = new Date().toISOString();
  return `BTC / ${quote.source}`;
}

function fearGreedReading(value, timestamp, now = Date.now()) {
  if (value === null || value === undefined || String(value).trim() === "") throw new Error("Invalid F&G value");
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100 || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now) {
    throw new Error("Invalid F&G observation");
  }
  return { value: number, observedAt: new Date(timestamp).toISOString() };
}

// Alternative.me is the primary BTC index. CMC is a distinct, unscored auxiliary.
export async function updateFearGreed(data, fetchImpl) {
  const [primary, auxiliary] = await Promise.allSettled([
    (async () => {
      const payload = await fetchJson("https://api.alternative.me/fng/?limit=1&format=json", fetchImpl);
      const row = payload.data?.[0];
      return fearGreedReading(row?.value, /^\d+$/.test(String(row?.timestamp)) ? Number(row.timestamp) * 1000 : NaN);
    })(),
    (async () => {
      const payload = await fetchJson("https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest", fetchImpl);
      return fearGreedReading(payload.data?.value, btcObservationTimestamp(payload.data?.update_time));
    })()
  ]);
  data.market.fngAux = auxiliary.status === "fulfilled"
    ? { ...auxiliary.value, indicator: "cmc-market", source: "CoinMarketCap", readStatus: "ok" }
    : { ...data.market.fngAux, indicator: "cmc-market", source: "CoinMarketCap", readStatus: "failed" };
  if (primary.status !== "fulfilled") {
    data.market.fngReadStatus = "failed";
    throw new Error("Alternative.me primary unavailable / 主源不可用，保留原读数");
  }
  const quote = primary.value;
  const previousTime = btcObservationTimestamp(data.market.fngFetchedAt);
  if (data.market.fngSource === "Alternative.me" && Number.isFinite(previousTime) && Date.parse(quote.observedAt) < previousTime) {
    data.market.fngReadStatus = "failed";
    throw new Error("Alternative.me older observation / 主源返回更旧读数，保留原值");
  }
  Object.assign(data.market, { fng: quote.value, fngSource: "Alternative.me", fngIndicator: "alternative-btc",
    fngFetchedAt: quote.observedAt, fngReadStatus: "ok" });
  return "F&G / Alternative.me";
}

async function updateStablecoins(data, fetchImpl) {
  return refreshStablecoins(data, url => fetchJson(url, fetchImpl));
}

async function frankfurterDxy(fetchImpl) {
  const end = new Date();
  const start = new Date(end.getTime() - 12 * 86_400_000);
  const iso = (date) => date.toISOString().slice(0, 10);
  const payload = await fetchJson(`https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=USD&symbols=EUR,JPY,GBP,CAD,SEK,CHF`, fetchImpl);
  const dates = Object.keys(payload.rates || {}).sort();
  if (dates.length < 2) throw new Error("ECB 汇率样本不足");
  const price = calculateDxyFromRates(payload.rates[dates.at(-1)]);
  const previous = calculateDxyFromRates(payload.rates[dates.at(-2)]);
  return { price, change: ((price / previous) - 1) * 100, changeBasis: "daily-reference", comparisonAsOf: dates.at(-2), instrument: "DXY-ECB", fetchedLabel: `${dates.at(-1)} ECB 日终` };
}

async function openErDxy(fetchImpl) {
  const payload = await fetchJson("https://open.er-api.com/v6/latest/USD", fetchImpl);
  return {
    price: calculateDxyFromRates(payload.rates),
    change: null,
    instrument: "DXY-FX-ESTIMATE",
    fetchedLabel: payload.time_last_update_utc || null
  };
}

export async function loadYahooMacro(symbol, fetchImpl) {
  const payload = await fetchJson(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`, fetchImpl);
  const meta = payload.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice), previous = Number(meta?.previousClose);
  const time = Number(meta?.regularMarketTime) * 1000;
  return { price, change: Number.isFinite(previous) && previous > 0 ? (price / previous - 1) * 100 : null,
    changeBasis: "previous-close", instrument: symbol,
    fetchedLabel: Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null };
}

export async function updateDxy(data, fetchImpl) {
  const quote = await firstProvider([
    { name: "Yahoo Finance", url: "https://finance.yahoo.com/quote/DX-Y.NYB/", load: () => loadYahooMacro("DX-Y.NYB", fetchImpl) },
    { name: "ECB / Frankfurter", url: "https://frankfurter.dev/", load: () => frankfurterDxy(fetchImpl) },
    { name: "ExchangeRate-API 推导", url: "https://www.exchangerate-api.com/", load: () => openErDxy(fetchImpl) }
  ], value => Number.isFinite(value.price) && value.price > 0 && (value.change === null || Number.isFinite(value.change)));
  return applyMacroQuote(card(data, 5), quote, { id: 5 });
}

async function updateMacroQuote(data, fetchImpl, { id, prefix = "" }) {
  if (id === 5) return updateDxy(data, fetchImpl);
  const target = card(data, id);
  const providers = [
    {
      name: "Gold API",
      url: "https://gold-api.com/",
      load: async () => {
        const payload = await fetchJson("https://api.gold-api.com/price/XAU", fetchImpl);
        return { price: Number(payload.price), change: null, instrument: "XAU-USD-SPOT", fetchedLabel: payload.updatedAt };
      }
    },
    {
      name: "GoldPrice.dev",
      url: "https://goldprice.dev/",
      load: async () => {
        const payload = await fetchJson("https://api.goldprice.dev/v1/prices?symbol=XAU-USD-SPOT", fetchImpl);
        const row = payload.symbols?.[0];
        return { price: Number(row?.price), change: null, instrument: "XAU-USD-SPOT", fetchedLabel: row?.computed_at };
      }
    }
  ];

  const quote = await firstProvider(providers, (value) =>
    Number.isFinite(value.price) && value.price > 0 && (value.change === null || Number.isFinite(value.change)));
  return applyMacroQuote(target, quote, { id, prefix });
}

const updateWma = (data, fetchImpl) => updateWeeklyMean(data, fetchImpl, new Date(), { snapshotFirst: true });

export async function refreshPublicDashboard(input, { fetchImpl = globalThis.fetch, onProgress } = {}) {
  const data = cloneDashboard(input), visible = cloneDashboard(input);
  let etfDataset;
  const tasks = [
    ["ETF", () => updateEtf(data, fetchImpl, (value) => { etfDataset = value; })],
    ["mNAV", () => updateMnavFromSnapshot(data, fetchImpl)],
    ["MVRV", () => updateOnchainFromSnapshot(data, 7, fetchImpl)],
    ["Puell", () => updateOnchainFromSnapshot(data, 8, fetchImpl)],
    ["BTC", () => updateBtc(data, fetchImpl)],
    ["F&G", () => updateFearGreed(data, fetchImpl)],
    ["稳定币", () => updateStablecoins(data, fetchImpl)],
    ["Fed", () => updateFed(data, fetchImpl)],
    ["True Market Mean", () => updateTrueMarketMean(data, fetchImpl)],
    ["DXY", () => updateMacroQuote(data, fetchImpl, { id: 5 })],
    ["黄金", () => updateMacroQuote(data, fetchImpl, { id: 6, prefix: "$" })],
    ["200WMA", () => updateWma(data, fetchImpl)]
  ];

  const cardByTask = { ETF: 1, mNAV: 2, MVRV: 7, Puell: 8, "稳定币": 3, Fed: 4, DXY: 5, "黄金": 6 };
  const marketFields = {
    BTC: ["btcPrice", "btcCurrency", "btcChange24h", "btcChange", "btcSource", "btcFetchedAt", "btcObservedAt"],
    "F&G": ["fng", "fngSource", "fngFetchedAt", "fngIndicator", "fngReadStatus", "fngAux"],
    "200WMA": ["wma200", "wmaSource", "wmaFetchedAt", "wmaObservation", "wmaRefreshStatus", "wmaRefreshError"]
  };
  const settled = new Map();
  const report = (name = "", status = "pending") => {
    const event = { completed: settled.size, total: tasks.length, name, status,
      checks: [...settled.values()].map(check => ({ ...check })) };
    if (settled.size) event.data = cloneDashboard(visible);
    if (name === "ETF" && status === "ok") event.etfDataset = cloneDashboard(etfDataset);
    try { onProgress?.(event); }
    catch { /* Rendering must not alter a source outcome. */ }
  };
  const finish = (name, status, value) => {
    const checkedAt = new Date().toISOString();
    const message = status === "ok" ? value : value?.message || "刷新失败";
    const check = status === "ok" ? { name, status, result: message, checkedAt } : { name, status, message, checkedAt };
    settled.set(name, check);
    const id = cardByTask[name], target = id ? card(data, id) : null;
    if (target) {
      Object.assign(target, { refreshStatus: status === "failed" ? "failed" : ["ETF", "Fed"].includes(name) ? target.refreshStatus : "ok",
        refreshMessage: message, refreshMethod: ["mNAV", "MVRV", "Puell"].includes(name) ? "scheduled-snapshot" : "public-manual",
        lastRefreshAt: checkedAt });
      const index = visible.cards.findIndex(item => item.id === id);
      if (index >= 0) visible.cards[index] = cloneDashboard(target);
    }
    if (name === "True Market Mean" && data.trueMarketMean) {
      Object.assign(data.trueMarketMean, { refreshStatus: status, lastRefreshAt: checkedAt,
        ...(status === "failed" ? { refreshMessage: message } : {}) });
      visible.trueMarketMean = cloneDashboard(data.trueMarketMean);
    }
    for (const key of marketFields[name] || []) {
      if (key in data.market) visible.market[key] = cloneDashboard({ value: data.market[key] }).value;
      else delete visible.market[key];
    }
    if (Number.isFinite(visible.market.wma200) && visible.market.wma200 > 0) visible.market.wmaRatio = visible.market.btcPrice / visible.market.wma200;
    visible.dataMode = "公开混合数据";
    visible.refreshChecks = [...settled.values()].map(item => ({ ...item }));
    report(name, status);
  };
  report();
  await Promise.all(tasks.map(async ([name, run]) => {
    let value;
    try { value = await run(); }
    catch (error) { finish(name, "failed", error); return; }
    finish(name, "ok", value);
  }));
  const checks = tasks.map(([name]) => settled.get(name));
  const updated = checks.filter(check => check.status === "ok").map(check => check.result);
  const warnings = checks.filter(check => check.status === "failed").map(check => `${check.name}：${check.message}`);
  if (Number.isFinite(data.market.wma200) && data.market.wma200 > 0) data.market.wmaRatio = data.market.btcPrice / data.market.wma200;
  const now = new Date(), checkedAt = now.toISOString();
  data.date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  data.updatedAt = checkedAt;
  data.dataMode = warnings.length ? "公开混合数据" : "公开实时数据";
  data.refreshChecks = checks;
  return { data, updated, warnings, checkedAt, etfDataset };
}
