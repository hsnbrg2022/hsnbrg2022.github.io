import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assessMarket } from "../data-quality.js";
import { selectBtcQuote, refreshPublicDashboard } from "../public-refresh.js";
const base = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url)));
const now = new Date("2026-09-11T08:00:00Z");

test("BTC获取时间不能冒充来源观测时间；15分钟边界按来源时间判断", () => {
  const market = { btcPrice: 75000, btcCurrency: "USD", btcFetchedAt: now.toISOString() };
  assert.equal(assessMarket(market, now).btc.eligible, false);
  for (const btcObservedAt of [null, "2026-02-30T08:00:00Z", "2026-09-11T08:00:01Z"]) assert.equal(assessMarket({ ...market, btcObservedAt }, now).btc.eligible, false);
  market.btcObservedAt = new Date(+now - 15 * 60000).toISOString();
  assert.equal(assessMarket(market, now).btc.eligible, true);
  assert.equal(assessMarket(market, new Date(+now + 1)).btc.state, "stale");
});

test("选源拒绝缺失、非法、未来、过期及倒退时间；相同时间可重复确认", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const provider = (name, timestamp) => ({ name, load: async () => ({ price: 75000, currency: "USD", change: 1, timestamp }) });
  for (const stamp of [undefined, null, NaN, Infinity, "1789113600000", +now + 1, +now - 900001]) {
    const quote = await selectBtcQuote([provider("DefiLlama", stamp), provider("Coinbase", +now)]);
    assert.equal(quote.source, "Coinbase");
  }
  const market = { btcObservedAt: new Date(+now - 1000).toISOString() };
  const quote = await selectBtcQuote([provider("DefiLlama", +now - 2000), provider("Coinbase", +now - 1000)], market);
  assert.equal(quote.source, "Coinbase");
});

test("公开源真实观测时间单独保存；缓存旧时间不因获取而推进，缺时间失败保留整组", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const input = structuredClone(base);
  delete input.market.btcObservedAt;
  const run = last_updated_at => refreshPublicDashboard(input, { fetchImpl: async url => {
    if (url.includes("simple/price")) {
      assert.match(url, /include_last_updated_at=true/);
      return { ok: true, json: async () => ({ bitcoin: { usd: 75000, usd_24h_change: 1, last_updated_at } }) };
    }
    throw new Error("offline");
  } });
  const valid = await run((+now - 60000) / 1000);
  assert.equal(valid.data.market.btcObservedAt, new Date(+now - 60000).toISOString());
  assert.equal(valid.data.market.btcFetchedAt, now.toISOString());
  const invalid = await run(undefined);
  assert.equal(invalid.updated.some(name => name.startsWith("BTC /")), false);
  for (const key of ["btcObservedAt", "btcFetchedAt", "btcPrice", "btcCurrency", "btcSource", "btcChange"]) assert.deepEqual(invalid.data.market[key], input.market[key]);
});

test("Kraken价格与成交时间绑定，不借其他笔成交或游标时间给ticker翻新", async t => {
  t.mock.timers.enable({ apis: ["Date"], now });
  const input = structuredClone(base);
  delete input.market.btcObservedAt;
  for (const timestamp of [(+now - 1000) / 1000, undefined, (+now - 900001) / 1000]) {
    const result = await refreshPublicDashboard(input, { fetchImpl: async url => {
      if (url.includes("/Trades?")) return { ok: true, json: async () => ({ result: { XXBTZUSD: [["74000", "1", timestamp]], last: String(+now * 1000000) } }) };
      if (url.includes("/Ticker?")) return { ok: true, json: async () => ({ result: { XXBTZUSD: { c: ["80000"], o: "70000" } } }) };
      throw new Error("offline");
    } });
    if (timestamp === (+now - 1000) / 1000) {
      assert.equal(result.data.market.btcPrice, 74000);
      assert.equal(result.data.market.btcObservedAt, new Date(+now - 1000).toISOString());
    } else assert.equal(result.updated.some(name => name.startsWith("BTC /")), false);
  }
});
