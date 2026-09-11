import { calculateDxyFromRates, applyBtcChange } from "./model.js?v=20260911-2";
import { BTC_MAX_AGE_MS, btcObservationTimestamp } from "./data-quality.js?v=20260911-2";
import { updateStablecoins as refreshStablecoins } from "./stablecoin-source.js?v=20260909-1";
import { etfSignal } from "./etf-core.js?v=20260905-3";
import { tradingDaysSince } from "./trading-calendar.js";
import { updateWeeklyMean } from "./weekly-mean.js?v=20260905-3";
import { applyFedDatasetToDashboard } from "./fed-signals.js?v=20260829-1";
import { applyTrueMarketMeanDataset } from "./true-market-mean.js?v=20260829-1";
import { updateMnavFromSnapshot } from "./mnav-source.js?v=20260906-5";
import { updateOnchainFromSnapshot } from "./onchain-source.js?v=20260906-5";
import { applyMacroQuote } from "./macro-quote.js?v=20260905-2";

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
  target.manualEntry = dataset.source?.method === "manual-entry";
  const age = tradingDaysSince(target.dataAsOf, now);
  target.refreshStatus = age > 2 ? "stale" : dataset.status === "live" ? "ok" : "snapshot";
  target.refreshMessage = `ETF / ${target.source.label} · 截至 ${target.dataAsOf}`;
  return target.refreshStatus === "stale" ? `ETF 数据可能滞后 / ${target.source.label}` : target.refreshStatus === "snapshot" ? `ETF 发布快照 / ${target.source.label}` : `ETF / ${target.source.label}`;
}

async function updateEtf(data, fetchImpl, onDataset) {
  const dataset = await fetchJson(`./etf-flows.json?v=${Date.now()}`, fetchImpl);
  const message = applyEtfDatasetToDashboard(data, dataset);
  onDataset(dataset);
  return message;
}

async function updateFed(data, fetchImpl) {
  const dataset = await fetchJson(`./fed-signals.json?v=${Date.now()}`, fetchImpl);
  return applyFedDatasetToDashboard(data, dataset);
}

async function updateTrueMarketMean(data, fetchImpl) {
  const dataset = await fetchJson(`./true-market-mean.json?v=${Date.now()}`, fetchImpl);
  return applyTrueMarketMeanDataset(data, dataset);
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

async function updateFearGreed(data, fetchImpl) {
  const quote = await firstProvider([
    {
      name: "Alternative.me",
      url: "https://alternative.me/crypto/fear-and-greed-index/",
      load: async () => {
        const payload = await fetchJson("https://api.alternative.me/fng/?limit=1&format=json", fetchImpl);
        return { value: Number(payload.data?.[0]?.value), timestamp: Number(payload.data?.[0]?.timestamp) * 1000 };
      }
    },
    {
      name: "CoinMarketCap",
      url: "https://coinmarketcap.com/charts/fear-and-greed-index/",
      load: async () => {
        const payload = await fetchJson("https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/latest", fetchImpl);
        return { value: Number(payload.data?.value), timestamp: Date.parse(payload.data?.update_time) };
      }
    }
  ], (value) => Number.isFinite(value.value) && value.value >= 0 && value.value <= 100);
  data.market.fng = quote.value;
  data.market.fngSource = quote.source;
  data.market.fngFetchedAt = new Date(Number.isFinite(quote.timestamp) ? quote.timestamp : Date.now()).toISOString();
  return `F&G / ${quote.source}`;
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

async function updateMacroQuote(data, fetchImpl, { id, prefix = "" }) {
  const target = card(data, id);
  const providers = id === 5 ? [
    { name: "ECB / Frankfurter", url: "https://frankfurter.dev/", load: () => frankfurterDxy(fetchImpl) },
    { name: "ExchangeRate-API 推导", url: "https://www.exchangerate-api.com/", load: () => openErDxy(fetchImpl) }
  ] : [
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

export async function refreshPublicDashboard(input, { fetchImpl = globalThis.fetch } = {}) {
  const data = cloneDashboard(input);
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
  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  const updated = [];
  const warnings = [];
  const checkedAt = new Date().toISOString();
  const cardByTask = { ETF: 1, mNAV: 2, MVRV: 7, Puell: 8, "稳定币": 3, Fed: 4, DXY: 5, "黄金": 6 };
  const checks = [];

  results.forEach((result, index) => {
    const name = tasks[index][0];
    const target = cardByTask[name] ? card(data, cardByTask[name]) : null;
    const metricTarget = name === "True Market Mean" ? data.trueMarketMean : null;
    if (result.status === "fulfilled") {
      updated.push(result.value);
      checks.push({ name, status: "ok", result: result.value, checkedAt });
      if (target) Object.assign(target, {
        refreshStatus: ["ETF", "Fed"].includes(name) ? target.refreshStatus : "ok",
        refreshMessage: result.value,
        refreshMethod: ["MVRV", "Puell"].includes(name) ? "scheduled-snapshot" : "public-manual",
        lastRefreshAt: checkedAt
      });
      if (metricTarget) Object.assign(metricTarget, { refreshStatus: "ok", lastRefreshAt: checkedAt });
    } else {
      const message = result.reason?.message || "刷新失败";
      warnings.push(`${name}：${message}`);
      checks.push({ name, status: "failed", message, checkedAt });
      if (target) Object.assign(target, {
        refreshStatus: "failed",
        refreshMessage: message,
        refreshMethod: "public-manual",
        lastRefreshAt: checkedAt
      });
      if (metricTarget) Object.assign(metricTarget, {
        refreshStatus: "failed",
        refreshMessage: message,
        lastRefreshAt: checkedAt
      });
    }
  });

  if (Number.isFinite(data.market.wma200) && data.market.wma200 > 0) {
    data.market.wmaRatio = data.market.btcPrice / data.market.wma200;
  }
  const now = new Date();
  data.date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  data.updatedAt = checkedAt;
  data.dataMode = warnings.length ? "公开混合数据" : "公开实时数据";
  data.refreshChecks = checks;

  return { data, updated, warnings, checkedAt, etfDataset };
}
