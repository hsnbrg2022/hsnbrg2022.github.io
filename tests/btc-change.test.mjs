import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyBtcChange, btcChangeReading, deriveDashboard } from "../model.js";
import { btcChangePresentation } from "../i18n.js";
import { refreshPublicDashboard } from "../public-refresh.js";
const base = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url)));
const now = new Date("2026-09-09T08:00:00Z");
const reply = payload => ({ ok: true, json: async () => payload });
const withQuote = basis => {
  const data = structuredClone(base);
  Object.assign(data.market, { btcPrice: 75000, btcCurrency: "USD", btcSource: "test", btcObservedAt: now.toISOString(), btcFetchedAt: now.toISOString(), btcChange24h: 99 });
  applyBtcChange(data.market, { source: "test", change: 7.8, changeBasis: basis });
  return data;
};

test("切换非24h源清除旧24h字段；仅已知且有限的涨幅可展示", () => {
  const data = withQuote("rolling24h");
  assert.equal(data.market.btcChange24h, 7.8);
  for (const basis of ["utc-open", "previous-close", "historical", "unknown"]) {
    applyBtcChange(data.market, { source: "test", change: 8, changeBasis: basis });
    assert.equal(data.market.btcChange24h, null);
    assert.equal(data.market.btcPrice, 75000);
  }
  for (const value of [null, NaN, Infinity, "8"]) {
    applyBtcChange(data.market, { source: "test", change: value, changeBasis: "rolling24h" });
    assert.equal(btcChangeReading(data.market), null);
    assert.equal(data.market.btcChange24h, null);
  }
  assert.equal(btcChangeReading({ ...withQuote("rolling24h").market, btcSource: "different" }), null);
});

test("中英文显示具体基准；只有滚动24h涨幅触发24h风险，旧值或旧版元数据不触发", () => {
  const labels = { rolling24h: /24h/, "utc-open": /UTC open/, "previous-close": /previous close/, historical: /historical sample/ };
  for (const [basis, label] of Object.entries(labels)) {
    const data = deriveDashboard(withQuote(basis), now);
    assert.match(btcChangePresentation(data, "en").text, label);
    assert.equal(data.risks.some(r => /BTC 24h/.test(r)), basis === "rolling24h");
    assert.doesNotMatch(btcChangePresentation(data, "en").text, /[\u4e00-\u9fff]/);
    assert.match(btcChangePresentation(deriveDashboard(withQuote(basis), new Date(+now + 16 * 60000)), "zh").text, /待更新/);
  }
  const legacy = withQuote("rolling24h");
  delete legacy.market.btcChange;
  assert.match(btcChangePresentation(deriveDashboard(legacy, now), "zh").text, /口径待核验/);
  assert.doesNotMatch(deriveDashboard(legacy, now).risks.join(" "), /BTC 24h/);
});

test("公开 Kraken 降级为较UTC开盘，保留价格但不能沿用旧24h涨幅", async () => {
  const result = await refreshPublicDashboard(withQuote("rolling24h"), { fetchImpl: async url => {
    if (url.includes("/Trades?")) return reply({ result: { XXBTZUSD: [["75000", "1", Date.now() / 1000]] } });
    if (url.includes("kraken.com")) return reply({ result: { XXBTZUSD: { c: ["75000"], o: "70000" } } });
    throw new Error("offline");
  } });
  assert.equal(result.data.market.btcSource, "Kraken");
  assert.equal(result.data.market.btcChange.basis, "utc-open");
  assert.equal(result.data.market.btcChange24h, null);
});

test("DefiLlama 仅时间戳相差24小时的样本标24h，其余标历史对比", async () => {
  for (const age of [86400, 172800, null]) {
    const current = Math.floor(Date.now() / 1000);
    const result = await refreshPublicDashboard(base, { fetchImpl: async url => {
      if (url.includes("prices/current")) return reply({ coins: { "coingecko:bitcoin": { price: 75000, timestamp: current } } });
      if (url.includes("prices/historical")) return reply({ coins: { "coingecko:bitcoin": { price: 70000, timestamp: age === null ? undefined : current - age } } });
      throw new Error("offline");
    } });
    assert.equal(result.data.market.btcChange.basis, age === 86400 ? "rolling24h" : "historical");
    assert.equal(result.data.market.btcChange24h !== null, age === 86400);
  }
});

test("CoinGecko 合法零涨幅保留，null不冒充零；Coinbase按同份统计的last/open计算", async () => {
  for (const change of [0, null]) {
    const result = await refreshPublicDashboard(base, { fetchImpl: async url => {
      if (url.includes("simple/price")) return reply({ bitcoin: { usd: 75000, usd_24h_change: change, last_updated_at: Math.floor(Date.now() / 1000) } });
      if (url.endsWith("/ticker")) return reply({ price: "80000", time: new Date().toISOString() });
      if (url.endsWith("/stats")) return reply({ last: "75000", open: "70000" });
      throw new Error("offline");
    } });
    assert.equal(result.data.market.btcSource, change === null ? "Coinbase" : "CoinGecko");
    assert.equal(result.data.market.btcChange.basis, "rolling24h");
    assert.ok(Math.abs(result.data.market.btcChange24h - (change === null ? (75000 / 70000 - 1) * 100 : 0)) < 1e-9);
  }
  for (const last of [null, 0, -1, Infinity]) {
    const result = await refreshPublicDashboard(base, { fetchImpl: async url => {
      if (url.endsWith("/ticker")) return reply({ price: "80000", time: new Date().toISOString() });
      if (url.endsWith("/stats")) return reply({ last, open: "70000" });
      throw new Error("offline");
    } });
    assert.equal(result.updated.some(name => name.startsWith("BTC /")), false);
    for (const key of ["btcPrice", "btcChange24h", "btcChange", "btcSource", "btcFetchedAt"]) assert.deepEqual(result.data.market[key], base.market[key]);
  }
});
