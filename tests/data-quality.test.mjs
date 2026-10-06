import test from "node:test";
import assert from "node:assert/strict";
import { cardQuality, weekdaysSince } from "../data-quality.js";
import { applyMacroQuote } from "../macro-quote.js";
import { normalizeStablecoinHistory } from "../stablecoin-source.js";
const now = new Date("2026-09-05T08:00:00Z");

test("ETF/mNAV 两工作日边界和周末；不使用刷新检查时间翻新观测", () => {
  for (const id of [1, 2]) {
    const basis = { basisAsOf: "2026-08-31", mnavMode: "official-live" };
    assert.equal(cardQuality({ id, ...basis, dataAsOf: "2026-09-02" }, now).eligible, true);
    assert.equal(cardQuality({ id, ...basis, dataAsOf: "2026-09-01", lastRefreshAt: now.toISOString() }, now).state, "stale");
  }
  assert.equal(weekdaysSince("2026-09-04", new Date("2026-09-06T08:00:00Z")), 0);
  assert.equal(weekdaysSince("2026-09-04", new Date("2026-09-09T08:00:00Z")), 3);
});

test("三天、24小时、45天采用确认的时效边界", () => {
  for (const [id, days] of [[3, 3], [5, 3], [6, 3], [9, 1], [4, 45]]) {
    const checkNow = id === 3 ? new Date("2026-09-05T00:00:00Z") : now;
    const asOf = new Date(+checkNow - days * 86400000).toISOString();
    const input = { id, dataAsOf: asOf };
    if (id === 3) input.stablecoin = normalizeStablecoinHistory([0, 7].map(day => ({ date: (Date.parse(asOf) - day * 86400000) / 1000, totalCirculatingUSD: { peggedUSD: 300e9 } })), checkNow);
    assert.equal(cardQuality(input, checkNow).eligible, true);
    assert.equal(cardQuality(input, new Date(+checkNow + 1)).eligible, false);
  }
  assert.equal(cardQuality({ id: 5, marketFetchedAt: "2026-09-04 ECB 日终" }, now).eligible, true);
  assert.equal(cardQuality({ id: 5, marketFetchedAt: "Fri, 04 Sep 2026 00:00:00 GMT" }, now).eligible, true);
});

test("宏观接口未给观测时间时，不把请求时间当成行情时间", () => {
  const card = { id: 6, shortName: "黄金" };
  applyMacroQuote(card, { price: 4800, change: null, source: "test" }, { id: 6, now });
  assert.equal(card.marketQuote.asOf, null);
  assert.equal(cardQuality(card, now).eligible, false);
});

test("日期缺失、非法、未来及缺少来源日期的链上读数待核验", () => {
  for (const asOf of [undefined, "bad", "2026-13-01", "2026-02-30", "2026-09-06"]) {
    assert.equal(cardQuality({ id: 6, dataAsOf: asOf }, now).state, "unknown");
  }
  for (const id of [7, 8]) assert.equal(cardQuality({ id }, now).eligible, false);
});
