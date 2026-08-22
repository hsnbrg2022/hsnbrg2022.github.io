import { calculateDxyFromRates } from "./model.js";

const REQUEST_TIMEOUT_MS = 10_000;

function card(data, id) {
  return data.cards.find((item) => item.id === id);
}

function signed(value, digits = 2) {
  const number = Number(value);
  return `${number >= 0 ? "+" : ""}${number.toFixed(digits)}%`;
}

function cloneDashboard(data) {
  return typeof structuredClone === "function"
    ? structuredClone(data)
    : JSON.parse(JSON.stringify(data));
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

async function updateBtc(data, fetchImpl) {
  const asset = "coingecko:bitcoin";
  const previousTimestamp = Math.floor(Date.now() / 1000) - 86_400;
  const quote = await firstProvider([
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
        return { price, change: ((price / previousPrice) - 1) * 100, timestamp: Number(current?.timestamp) * 1000 };
      }
    },
    {
      name: "CoinGecko",
      url: "https://www.coingecko.com/en/coins/bitcoin",
      load: async () => {
        const payload = await fetchJson("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true", fetchImpl);
        return { price: Number(payload.bitcoin?.usd), change: Number(payload.bitcoin?.usd_24h_change) };
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
        return { price, change: ((price / open) - 1) * 100 };
      }
    },
    {
      name: "Kraken",
      url: "https://www.kraken.com/prices/bitcoin",
      load: async () => {
        const payload = await fetchJson("https://api.kraken.com/0/public/Ticker?pair=XBTUSD", fetchImpl);
        const ticker = Object.values(payload.result || {})[0];
        const price = Number(ticker?.c?.[0]);
        const open = Number(ticker?.o);
        return { price, change: ((price / open) - 1) * 100 };
      }
    }
  ], (value) => Number.isFinite(value.price) && value.price > 0 && Number.isFinite(value.change));

  data.market.btcPrice = quote.price;
  data.market.btcChange24h = quote.change;
  data.market.btcSource = quote.source;
  data.market.btcFetchedAt = new Date(Number.isFinite(quote.timestamp) ? quote.timestamp : Date.now()).toISOString();
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
  const quote = await firstProvider([
    {
      name: "DefiLlama",
      url: "https://defillama.com/stablecoins",
      load: async () => {
        const rows = await fetchJson("https://stablecoins.llama.fi/stablecoincharts/all", fetchImpl);
        const valid = rows.filter((row) => Number(row.totalCirculatingUSD?.peggedUSD) > 0);
        const latest = valid.at(-1);
        const weekAgo = valid.at(-8) || valid.at(0);
        const total = Number(latest?.totalCirculatingUSD?.peggedUSD);
        const previous = Number(weekAgo?.totalCirculatingUSD?.peggedUSD);
        return { total, change: ((total / previous) - 1) * 100, period: "7d", date: Number(latest?.date) * 1000 };
      }
    },
    {
      name: "CoinGecko",
      url: "https://www.coingecko.com/en/categories/stablecoins",
      load: async () => {
        const rows = await fetchJson("https://api.coingecko.com/api/v3/coins/categories", fetchImpl);
        const stablecoins = rows.find((row) => row.id === "stablecoins");
        return { total: Number(stablecoins?.market_cap), change: Number(stablecoins?.market_cap_change_24h), period: "24h", date: Date.now() };
      }
    }
  ], (value) => Number.isFinite(value.total) && value.total > 0 && Number.isFinite(value.change));

  const target = card(data, 3);
  target.headline = `$${(quote.total / 1e8).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} 亿 · ${quote.period} ${signed(quote.change)}`;
  target.facts = [quote.change >= 0 ? "稳定币供给扩张" : "稳定币供给收缩", `最近数据 ${new Date(quote.date).toLocaleDateString("zh-CN")}`];
  target.detail = quote.change >= 0
    ? "稳定币供给保持扩张，链上可用流动性改善。"
    : "稳定币供给出现收缩，需关注链上流动性压力。";
  target.status = quote.change > 0 ? "green" : quote.change > -0.3 ? "yellow" : "red";
  target.change = `${quote.period} ${signed(quote.change)}`;
  target.source = { label: quote.source, url: quote.sourceUrl };
  target.marketFetchedAt = new Date(quote.date).toISOString();
  return `稳定币 / ${quote.source}`;
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
  return { price, change: ((price / previous) - 1) * 100, fetchedLabel: `${dates.at(-1)} ECB 日终` };
}

async function openErDxy(fetchImpl) {
  const payload = await fetchJson("https://open.er-api.com/v6/latest/USD", fetchImpl);
  return {
    price: calculateDxyFromRates(payload.rates),
    change: null,
    fetchedLabel: payload.time_last_update_utc || new Date().toISOString()
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
        return { price: Number(payload.price), change: null, fetchedLabel: payload.updatedAt };
      }
    },
    {
      name: "GoldPrice.dev",
      url: "https://goldprice.dev/",
      load: async () => {
        const payload = await fetchJson("https://api.goldprice.dev/v1/prices?symbol=XAU-USD-SPOT", fetchImpl);
        const row = payload.symbols?.[0];
        return { price: Number(row?.price), change: null, fetchedLabel: row?.computed_at };
      }
    }
  ];

  const quote = await firstProvider(providers, (value) =>
    Number.isFinite(value.price) && value.price > 0 && (value.change === null || Number.isFinite(value.change)));
  const previousDisplayedPrice = Number(target.headline.match(/[\d,]+(?:\.\d+)?/)?.[0]?.replaceAll(",", ""));
  const fallbackChange = Number.isFinite(previousDisplayedPrice) && previousDisplayedPrice > 0
    ? ((quote.price / previousDisplayedPrice) - 1) * 100
    : 0;
  const change = Number.isFinite(quote.change) ? quote.change : fallbackChange;
  const changeText = Number.isFinite(quote.change) ? signed(change) : `较发布值 ${signed(change)}`;
  target.headline = `${prefix}${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${changeText}`;
  target.change = changeText;
  if (id === 5) {
    target.facts = [quote.price < 100 ? "守在 100 下方" : "升至 100 上方", change < 0 ? "风险资产顺风" : "美元走强施压"];
    target.status = quote.price < 100 ? "green" : quote.price < 103 ? "yellow" : "red";
    target.detail = quote.price < 100 ? "美元指数维持弱势，为风险资产提供宏观顺风。" : "美元指数走强，风险资产的流动性环境承压。";
  } else {
    target.facts = [change >= 0 ? "较发布值走强" : "较发布值回落", "同步观察实际利率"];
    target.status = change >= -1 ? "green" : "yellow";
    target.detail = "黄金用于交叉验证美元、实际利率与避险需求的变化。";
  }
  target.source = { label: quote.source, url: quote.sourceUrl };
  target.marketFetchedAt = quote.fetchedLabel || new Date().toISOString();
  return `${target.shortName} / ${quote.source}`;
}

async function updateWma(data, fetchImpl) {
  const start = Math.floor(Date.now() / 1000) - (205 * 7 * 86_400);
  const quote = await firstProvider([
    {
      name: "DefiLlama",
      url: "https://defillama.com/",
      load: async () => {
        const payload = await fetchJson(`https://coins.llama.fi/chart/coingecko:bitcoin?start=${start}&span=205&period=1w&searchWidth=1d`, fetchImpl);
        return { closes: (payload.coins?.["coingecko:bitcoin"]?.prices || []).map((row) => Number(row.price)).filter(Number.isFinite) };
      }
    },
    {
      name: "Kraken",
      url: "https://www.kraken.com/prices/bitcoin",
      load: async () => {
        const payload = await fetchJson("https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=10080", fetchImpl);
        const rows = Object.entries(payload.result || {}).find(([key, value]) => key !== "last" && Array.isArray(value))?.[1] || [];
        return { closes: rows.map((row) => Number(row[4])).filter(Number.isFinite) };
      }
    }
  ], (value) => Array.isArray(value.closes) && value.closes.length >= 190);

  const closes = quote.closes.slice(-200);
  const average = closes.reduce((sum, value) => sum + value, 0) / closes.length;
  data.market.wma200 = average;
  data.market.wmaRatio = data.market.btcPrice / average;
  data.market.wmaSource = quote.source;
  data.market.wmaFetchedAt = new Date().toISOString();
  return `200WMA / ${quote.source}`;
}

export async function refreshPublicDashboard(input, { fetchImpl = globalThis.fetch } = {}) {
  const data = cloneDashboard(input);
  const tasks = [
    ["BTC", () => updateBtc(data, fetchImpl)],
    ["F&G", () => updateFearGreed(data, fetchImpl)],
    ["稳定币", () => updateStablecoins(data, fetchImpl)],
    ["DXY", () => updateMacroQuote(data, fetchImpl, { id: 5 })],
    ["黄金", () => updateMacroQuote(data, fetchImpl, { id: 6, prefix: "$" })],
    ["200WMA", () => updateWma(data, fetchImpl)]
  ];
  const results = await Promise.allSettled(tasks.map(([, run]) => run()));
  const updated = [];
  const warnings = [];
  const checkedAt = new Date().toISOString();
  const cardByTask = { "稳定币": 3, DXY: 5, "黄金": 6 };
  const checks = [];

  results.forEach((result, index) => {
    const name = tasks[index][0];
    const target = cardByTask[name] ? card(data, cardByTask[name]) : null;
    if (result.status === "fulfilled") {
      updated.push(result.value);
      checks.push({ name, status: "ok", result: result.value, checkedAt });
      if (target) Object.assign(target, {
        refreshStatus: "ok",
        refreshMessage: result.value,
        refreshMethod: "public-manual",
        lastRefreshAt: checkedAt
      });
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

  return { data, updated, warnings, checkedAt };
}
