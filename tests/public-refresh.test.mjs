import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { refreshPublicDashboard, updateFearGreed } from "../public-refresh.js";
import { currentWeekStart } from "../weekly-mean.js";
import { buildOnchainDataset } from "../scripts/update-onchain.mjs";

const dashboardPath = new URL("../dashboard.json", import.meta.url);

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("F&G主指标不受更快CMC辅助读数替换", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T08:00:00Z") });
  const data = { market: {} };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = updateFearGreed(data, async url => {
    if (url.includes("alternative.me")) { await gate; return response({ data: [{ value: "50", timestamp: "1792713600" }] }); }
    return response({ data: { value: 80, update_time: "2026-10-23T01:00:00Z" } });
  });
  release();
  await pending;
  assert.equal(data.market.fng, 50);
  assert.equal(data.market.fngSource, "Alternative.me");
  assert.equal(data.market.fngIndicator, "alternative-btc");
  assert.equal(data.market.fngFetchedAt, "2026-10-23T00:00:00.000Z");
  assert.equal(data.market.fngAux.value, 80);
  assert.equal(data.market.fngAux.indicator, "cmc-market");
});

test("F&G主源失败保留主值和日期，CMC成功只更新辅助", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T08:00:00Z") });
  const market = { fng: 25, fngSource: "Alternative.me", fngFetchedAt: "2026-10-22T00:00:00.000Z" };
  const data = { market: structuredClone(market) };
  await assert.rejects(() => updateFearGreed(data, async url => {
    if (url.includes("alternative.me")) throw new Error("offline");
    return response({ data: { value: 90, update_time: "2026-10-23T01:00:00Z" } });
  }), /主源不可用/);
  for (const key of Object.keys(market)) assert.equal(data.market[key], market[key]);
  assert.equal(data.market.fngReadStatus, "failed");
  assert.equal(data.market.fngAux.value, 90);
});

test("F&G缺失或未来观测时间及更旧主值均拒绝，不补造日期", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T08:00:00Z") });
  for (const timestamp of [undefined, "", "invalid", "1792886400", "1792627200"]) {
    const data = { market: { fng: 55, fngSource: "Alternative.me", fngFetchedAt: "2026-10-23T00:00:00.000Z" } };
    await assert.rejects(() => updateFearGreed(data, async url => {
      if (url.includes("alternative.me")) return response({ data: [{ value: "70", timestamp }] });
      throw new Error("aux offline");
    }));
    assert.equal(data.market.fng, 55);
    assert.equal(data.market.fngFetchedAt, "2026-10-23T00:00:00.000Z");
  }
});

test("F&G辅助失败不阻止有效主值，保留辅助旧观测不翻新", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-23T08:00:00Z") });
  const data = { market: { fngAux: { value: 40, observedAt: "2026-10-21T00:00:00.000Z", readStatus: "ok" } } };
  await updateFearGreed(data, async url => {
    if (url.includes("alternative.me")) return response({ data: [{ value: "0", timestamp: "1792713600" }] });
    throw new Error("aux offline");
  });
  assert.equal(data.market.fng, 0);
  assert.equal(data.market.fngReadStatus, "ok");
  assert.equal(data.market.fngAux.value, 40);
  assert.equal(data.market.fngAux.observedAt, "2026-10-21T00:00:00.000Z");
  assert.equal(data.market.fngAux.readStatus, "failed");
});

test("公开刷新可更新十二项数据（含 MVRV 与 Puell）", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const dashboard = JSON.parse(await readFile(dashboardPath, "utf8"));
  const weeklyPrices = Array.from({ length: 205 }, (_, index) => ({ timestamp: currentWeekStart() - (205 - index) * 604800, price: 20_000 + index * 200 }));
  const stablecoinRows = Array.from({ length: 8 }, (_, index) => ({
    date: Date.parse("2026-08-28T00:00:00Z") / 1000 + index * 86_400,
    totalCirculatingUSD: { peggedUSD: 300_000_000_000 + index * 1_000_000_000 }
  }));
  const rates = {
    "2026-08-20": { EUR: 0.86, JPY: 147, GBP: 0.74, CAD: 1.37, SEK: 9.6, CHF: 0.80 },
    "2026-08-21": { EUR: 0.85, JPY: 146, GBP: 0.73, CAD: 1.36, SEK: 9.5, CHF: 0.79 }
  };
  const mockFetch = async (url) => {
  if (/mvrv\.json|puell\.json/.test(url)) return response(buildOnchainDataset(url.includes("mvrv.json") ? 7 : 8, [{ timestamp: Date.parse("2026-09-03T00:00:00Z") / 1000, value: 0.9 }]));
  if (url.includes("strategy-mnav.json")) return response({
    schemaVersion: 1, status: "active", generatedAt: "2026-09-04T02:00:00Z",
    marketAsOf: "2026-09-03", basisAsOf: "2026-08-31", mnav: 1.15,
    formula: "mstr_price_usd / net_btc_per_share_usd", methodologyEffectiveDate: "2026-07-23",
    calculation: { mode: "official-live" },
    inputs: {
      mstrPriceUsd: 144.82, btcPriceUsd: 80_859.99, netBtcPerShareUsd: 126.1, netBtc: 661_982.56,
      btcHoldings: 845_050, usdAssetsUsd: 6_714_000_000, seniorClaimsUsd: 21_516_830_700,
      fullyDilutedShares: 424_479_000
    },
    source: { url: "https://www.strategy.com/btc" }
  });
  if (url.includes("etf-flows.json")) return response({
      asset: "BTC", unit: "USD_MILLIONS", status: "live", generatedAt: "2026-08-22T06:00:00Z",
      source: { label: "CoinGlass", url: "https://www.coinglass.com/bitcoin-etf" },
      rows: [
        { date: "2026-08-18", flowUsdMillions: 100 },
        { date: "2026-08-19", flowUsdMillions: 200 },
        { date: "2026-08-20", flowUsdMillions: 300 },
        { date: "2026-08-21", flowUsdMillions: 400 }
      ]
    });
    if (url.includes("fed-signals.json")) return response({
      schemaVersion: 1, generatedAt: "2026-08-29T00:00:00Z",
      fomc: { eventDate: "2026-07-29", action: "hold", targetRange: { lower: 3.5, upper: 3.75 }, url: "https://www.federalreserve.gov/fomc" },
      chair: { eventDate: "2026-08-28", tone: "hawkish" },
      nextMeeting: { startDate: "2026-09-15", endDate: "2026-09-16" }
    });
    if (url.includes("true-market-mean.json")) return response({
      schemaVersion: 1, status: "active", generatedAt: "2026-09-04T07:22:17.483Z",
      asOf: "2026-09-03", value: 76_334.89,
      formula: "glassnode_price_usd_close / glassnode_aviv",
      inputs: { priceUsdClose: 77_842.6453180136, aviv: 1.0197517874624005, timestamp: 1_788_393_600 },
      validation: { sameUtcTimestamp: true, dataAgeDays: 1, activation: "active" },
      source: { label: "Glassnode Public MCP", url: "https://studio.glassnode.com/charts/indicators.Aviv?a=BTC" }
    });
    if (url.includes("prices/current")) return response({ coins: { "coingecko:bitcoin": { price: 75_000, timestamp: Math.floor(Date.now() / 1000) } } });
    if (url.includes("prices/historical")) return response({ coins: { "coingecko:bitcoin": { price: 72_000 } } });
    if (url.includes("alternative.me")) return response({ data: [{ value: "74", timestamp: String(Math.floor(Date.now() / 1000)) }] });
    if (url.includes("stablecoincharts")) return response(stablecoinRows);
    if (url.includes("frankfurter.dev")) return response({ rates });
    if (url.includes("gold-api.com")) return response({ price: 4588.5, updatedAt: "2026-08-22T06:00:00Z" });
    if (url.includes("finance.yahoo.com/v8/finance/chart")) return response({ chart: { result: [{ timestamp: weeklyPrices.map((row) => row.timestamp), indicators: { quote: [{ close: weeklyPrices.map((row) => row.price) }] } }] } });
    throw new Error(`unexpected ${url}`);
  };

  const result = await refreshPublicDashboard(dashboard, { fetchImpl: mockFetch });
  assert.equal(result.updated.length, 12);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.data.market.btcPrice, 75_000);
  assert.equal(result.data.market.fng, 74);
  assert.equal(result.data.market.wmaSource, "Yahoo Finance");
  assert.equal(result.data.market.wmaObservation.sampleCount, 200);
  assert.match(result.data.cards.find((item) => item.id === 3).headline, /7d \+/);
  assert.match(result.data.cards.find((item) => item.id === 6).headline, /\$4,588\.50/);
  assert.equal(result.data.cards.find((item) => item.id === 5).refreshMethod, "public-manual");
  assert.equal(result.data.cards.find((item) => item.id === 1).source.label, "CoinGlass");
  assert.equal(result.data.cards.find((item) => item.id === 4).status, "yellow");
  assert.equal(result.data.trueMarketMean.value, 76_334.89);
  assert.equal(result.data.trueMarketMean.refresh, "auto");
  assert.equal(result.data.trueMarketMean.refreshStatus, "ok");
  assert.match(result.data.cards.find((item) => item.id === 4).headline, /主席基调偏鹰/);
  assert.equal(result.data.cards.find((item) => item.id === 1).dataAsOf, "2026-08-21");
  assert.match(result.data.cards.find((item) => item.id === 2).headline, /1\.15x · MSTR \$144\.82/);
  assert.equal(result.data.cards.find((item) => item.id === 2).refresh, "auto");
  assert.equal(result.data.cards.find((item) => item.id === 2).refreshMethod, "scheduled-snapshot");
  assert.match(result.data.cards.find((item) => item.id === 1).headline, /连续 4 日净流入/);
  assert.equal(result.data.dataMode, "公开实时数据");
  assert.equal(result.etfDataset.asset, "BTC");
  assert.equal(result.etfDataset.rows.at(-1).date, "2026-08-21");
});

test("失败后恢复会清除宏观和稳定币失败标记，ETF 仍保留自己的数据年龄", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const dashboard = JSON.parse(await readFile(dashboardPath, "utf8"));
  const failed = await refreshPublicDashboard(dashboard, { fetchImpl: async () => { throw new Error("offline"); } });
  const rates = { EUR: 0.85, JPY: 146, GBP: 0.73, CAD: 1.36, SEK: 9.5, CHF: 0.79 };
  const recovered = await refreshPublicDashboard(failed.data, { fetchImpl: async (url) => {
    if (url.includes("gold-api.com")) return response({ price: 4800, updatedAt: "2026-09-04T01:00:00Z" });
    if (url.includes("frankfurter.dev")) return response({ rates: { "2026-09-02": rates, "2026-09-03": rates } });
    if (url.includes("stablecoincharts")) return response(Array.from({ length: 8 }, (_, i) => ({ date: 1787875200 + i * 86400, totalCirculatingUSD: { peggedUSD: 300e9 + i * 1e9 } })));
    if (url.includes("etf-flows.json")) return response({ asset: "BTC", unit: "USD_MILLIONS", status: "snapshot", rows: [{ date: "2020-01-02", flowUsdMillions: 100 }] });
    throw new Error("unavailable");
  } });
  for (const id of [3, 5, 6]) assert.equal(recovered.data.cards.find((card) => card.id === id).refreshStatus, "ok");
  assert.equal(recovered.data.cards.find((card) => card.id === 1).refreshStatus, "stale");
});

test("公开黄金同价重复刷新保持观察，不从旧文案制造涨跌率", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const dashboard = JSON.parse(await readFile(dashboardPath, "utf8"));
  dashboard.cards.find((card) => card.id === 6).headline = "$5,000.00 · +1.00%";
  const fetchImpl = async (url) => {
    if (url.includes("gold-api.com")) return response({ price: 4800, updatedAt: "2026-09-04T01:00:00Z" });
    throw new Error("unavailable");
  };
  const first = await refreshPublicDashboard(dashboard, { fetchImpl });
  const second = await refreshPublicDashboard(first.data, { fetchImpl });
  const before = first.data.cards.find((card) => card.id === 6);
  const after = second.data.cards.find((card) => card.id === 6);
  assert.equal(before.headline, after.headline);
  assert.equal(after.status, "yellow");
  assert.equal(after.marketQuote.changePct, null);
  assert.match(after.headline, /涨跌基准暂不可用/);
});

test("Fed 成功读取过期快照仍保留 stale，读取近期快照才恢复 ok", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-05T08:00:00Z") });
  const dashboard = JSON.parse(await readFile(dashboardPath, "utf8"));
  const refresh = (eventDate) => refreshPublicDashboard(dashboard, { fetchImpl: async (url) => {
    if (url.includes("fed-signals.json")) return response({
      schemaVersion: 1, generatedAt: "2026-09-05T00:00:00Z",
      fomc: { eventDate, action: "hold", targetRange: { lower: 3.5, upper: 3.75 }, url: "https://www.federalreserve.gov/" }
    });
    throw new Error("unavailable");
  } });
  assert.equal((await refresh("2026-01-01")).data.cards.find((card) => card.id === 4).refreshStatus, "stale");
  assert.equal((await refresh("2026-09-01")).data.cards.find((card) => card.id === 4).refreshStatus, "ok");
});

test("单项失败时保留发布值并明确提示", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const dashboard = JSON.parse(await readFile(dashboardPath, "utf8"));
  const before = dashboard.market.btcPrice;
  const trueMarketMeanBefore = structuredClone(dashboard.trueMarketMean);
  const result = await refreshPublicDashboard(dashboard, {
    fetchImpl: async () => { throw new Error("offline"); }
  });
  assert.equal(result.data.market.btcPrice, before);
  assert.equal(result.updated.length, 0);
  assert.equal(result.warnings.length, 12);
  assert.equal(result.data.dataMode, "公开混合数据");
  assert.equal(result.data.cards.find((item) => item.id === 3).refreshStatus, "failed");
  assert.equal(result.data.cards.find((item) => item.id === 2).refreshStatus, "failed");
  assert.equal(result.data.trueMarketMean.refreshStatus, "failed");
  assert.equal(result.data.trueMarketMean.value, trueMarketMeanBefore.value);
  assert.equal(result.data.trueMarketMean.asOf, trueMarketMeanBefore.asOf);
});
