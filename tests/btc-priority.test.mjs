import test from "node:test";
import assert from "node:assert/strict";
import * as refresh from "../public-refresh.js";

test("共享选择器不依赖传入数组顺序，跳过非法美元读数及未知源", async () => {
  const calls = [];
  const provider = (name, extra = {}) => ({ name, url: `https://example.test/${name}`, load: async () => { calls.push(name); return { price: 75000, change: 1, currency: "USD", timestamp: Date.now(), ...extra }; } });
  const quote = await refresh.selectBtcQuote([
    provider("unrecognized"), provider("Yahoo Finance"), provider("Kraken"),
    provider("Coinbase"), provider("CoinGecko", { price: NaN }), provider("DefiLlama", { currency: "USDT" })
  ]);
  assert.equal(quote.source, "Coinbase");
  assert.equal(quote.sourceUrl, "https://example.test/Coinbase");
  assert.deepEqual(calls, ["DefiLlama", "CoinGecko", "Coinbase"]);
  await assert.rejects(() => refresh.selectBtcQuote([]), /全部数据源不可用/);
});
