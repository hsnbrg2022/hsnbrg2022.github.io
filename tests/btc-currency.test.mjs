import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { applyBtcChange, deriveDashboard } from "../model.js";
import { btcPricePresentation, btcChangePresentation } from "../i18n.js";
import { refreshPublicDashboard } from "../public-refresh.js";

const base = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url)));
const now = new Date();
const fixture = currency => {
  const data = structuredClone(base);
  Object.assign(data.market, { btcPrice: 75000, btcCurrency: currency, btcSource: "test", btcFetchedAt: now.toISOString(), btcObservedAt: new Date(+now - 60000).toISOString() });
  applyBtcChange(data.market, { change: 7.8, changeBasis: "rolling24h", source: "test" });
  data.previous = { ...data.previous, btcPrice: 70000, btcCurrency: "USD" };
  return data;
};
const btcKeys = ["btcPrice", "btcCurrency", "btcChange", "btcChange24h", "btcSource", "btcFetchedAt", "btcObservedAt"];
const unchanged = (actual, expected) => { for (const key of btcKeys) assert.deepEqual(actual.market[key], expected.market[key]); };

test("美元元数据才允许当前价格结论；USDT和未知旧值保留但不冒充美元，中英文一致", () => {
  const usd = deriveDashboard(fixture("USD"), now);
  assert.equal(usd.marketQuality.btc.eligible, true);
  assert.equal(btcPricePresentation(usd.market).text, "$75,000");
  for (const currency of [undefined, null, "USDT", "EUR", "usd", ""]) {
    const data = deriveDashboard(fixture(currency), now);
    assert.equal(data.market.btcPrice, 75000);
    assert.equal(data.marketQuality.btc.eligible, false);
    assert.equal(data.score, usd.score);
    assert.doesNotMatch(data.risks.join(" "), /BTC 24h/);
    assert.doesNotMatch(data.previous.changes.join(" "), /BTC \$/);
    for (const language of ["zh", "en"]) {
      const price = btcPricePresentation(data.market, language);
      assert.equal(price.text, "75,000");
      assert.equal(price.currency, currency === "USDT" ? "USDT" : language === "en" ? "Currency unverified" : "币种待核验");
      assert.doesNotMatch(btcChangePresentation(data, language).text, /7.80%/);
    }
  }
});

test("历史基线币种未知或USDT时不与当前美元报价计算变化，USD基线仍可比较", () => {
  const data = fixture("USD");
  assert.match(deriveDashboard(data, now).previous.changes[0], /\$70,000 → \$75,000/);
  for (const currency of [undefined, "USDT"]) {
    data.previous.btcCurrency = currency;
    assert.equal(deriveDashboard(data, now).previous.changes[0], "BTC $75,000");
  }
});

const current = Math.floor(+now / 1000);
const payloads = {
  DefiLlama: url => ({ coins: { "coingecko:bitcoin": { price: url.includes("historical") ? 70000 : 75000, timestamp: url.includes("historical") ? current - 86400 : current } } }),
  CoinGecko: () => ({ bitcoin: { usd: 75000, usd_24h_change: 7.8, last_updated_at: current } }),
  Coinbase: url => url.endsWith("/stats") ? { last: "75000", open: "70000" } : { price: "75000", time: now.toISOString() },
  Kraken: url => ({ result: { XXBTZUSD: url.includes("/Trades?") ? [["75000", "1", current]] : { c: ["75000"], o: "70000" } } })
};
const domains = { DefiLlama: "coins.llama.fi", CoinGecko: "api.coingecko.com", Coinbase: "api.exchange.coinbase.com", Kraken: "api.kraken.com" };

test("公开四个BTC美元源都带币种；Kraken不接受其他交易对，失败原样保留旧报价组", async () => {
  for (const name of Object.keys(payloads)) {
    const result = await refreshPublicDashboard(fixture("USDT"), { fetchImpl: async url => {
      if (url.includes(domains[name])) return { ok: true, json: async () => payloads[name](url) };
      throw new Error("offline");
    } });
    assert.equal(result.data.market.btcSource, name);
    assert.ok(Number.isFinite(Date.parse(result.data.market.btcObservedAt)));
    assert.ok(Date.parse(result.data.market.btcObservedAt) <= Date.parse(result.data.market.btcFetchedAt));
    assert.equal(result.data.market.btcCurrency, "USD");
    assert.equal(result.data.market.btcPrice, 75000);
  }
  const input = fixture("USDT");
  const result = await refreshPublicDashboard(input, { fetchImpl: async url => {
    if (url.includes("kraken.com")) return { ok: true, json: async () => ({ result: { XBTUSDT: { c: ["75000"], o: "70000" } } }) };
    throw new Error("offline");
  } });
  assert.equal(result.updated.some(name => name.startsWith("BTC /")), false);
  unchanged(result.data, input);
});
