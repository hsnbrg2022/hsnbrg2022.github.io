import test from "node:test";
import assert from "node:assert/strict";
import { applyMacroQuote } from "../macro-quote.js";
import { translateText } from "../i18n.js";
import { updateDxy } from "../public-refresh.js";

test("DXY两端共用顺序优先实际指数，不请求更快近似值", async () => {
  const target = { id: 5, shortName: "DXY" }, calls = [];
  await updateDxy({ cards: [target] }, async url => {
    calls.push(url);
    return { ok: true, json: async () => ({ chart: { result: [{ meta: { regularMarketPrice: 102, previousClose: 100, regularMarketTime: 1788512400 } }] } }) };
  });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /DX-Y.NYB/);
  assert.equal(target.marketQuote.kind, "actual-index");
  assert.equal(target.marketQuote.instrument, "DX-Y.NYB");
  assert.equal(target.marketQuote.comparison.kind, "previous-close");
  assert.ok(Math.abs(target.marketQuote.changePct - 2) < 1e-10);
  assert.equal(target.status, "yellow");
});

test("DXY切换ECB或汇率快照近似只使用各自基准，不继承旧源涨幅", async () => {
  const rates = { EUR: 0.85, JPY: 146, GBP: 0.73, CAD: 1.36, SEK: 9.5, CHF: 0.79 };
  for (const useEcb of [true, false]) {
    const target = { id: 5, shortName: "DXY", marketQuote: { instrument: "DX-Y.NYB", changePct: 99 } };
    await updateDxy({ cards: [target] }, async url => {
      if (url.includes("finance.yahoo")) throw new Error("unavailable");
      if (url.includes("frankfurter")) {
        if (!useEcb) throw new Error("unavailable");
        return { ok: true, json: async () => ({ rates: { "2026-09-02": rates, "2026-09-03": rates } }) };
      }
      return { ok: true, json: async () => ({ rates, time_last_update_utc: "Fri, 04 Sep 2026 00:00:00 +0000" }) };
    });
    assert.equal(target.marketQuote.kind, "fx-basket-approximation");
    assert.equal(target.marketQuote.sourceChanged, true);
    assert.equal(target.marketQuote.changePct, useEcb ? 0 : null);
    assert.equal(target.marketQuote.comparison?.asOf ?? null, useEcb ? "2026-09-02" : null);
    assert.ok(target.facts.some(f => /近似/.test(f)));
    assert.doesNotMatch(target.facts.map(f => translateText(f, "en")).join(" "), /[一-鿿]/);
  }
});

test("DXY所有免费源失败保持原卡片及观测时间不变", async () => {
  const target = { id: 5, shortName: "DXY", headline: "old", status: "green", marketFetchedAt: "2026-09-03", marketQuote: { price: 99 } };
  const before = structuredClone(target);
  await assert.rejects(() => updateDxy({ cards: [target] }, async () => { throw new Error("offline"); }));
  assert.deepEqual(target, before);
});

test("同一已知前收基准驱动黄金信号，重复刷新和旧文案不会改变结果", () => {
  const card = { shortName: "黄金", headline: "$999,999 · 旧数据" };
  const quote = { price: 4800, change: -4, changeBasis: "previous-close", comparisonAsOf: "2026-09-03", instrument: "GC=F", source: "Yahoo", sourceUrl: "https://finance.yahoo.com/", fetchedLabel: "2026-09-04T20:00:00Z" };
  const now = new Date("2026-09-05T08:00:00Z");
  applyMacroQuote(card, quote, { id: 6, prefix: "$", now });
  const before = structuredClone(card);
  applyMacroQuote(card, quote, { id: 6, prefix: "$", now });
  assert.deepEqual(card, before);
  assert.equal(card.status, "yellow");
  assert.equal(card.marketQuote.comparison.asOf, "2026-09-03");
  assert.match(card.headline, /较前收 -4\.00%/);
});

test("切换到仅有现价的现货源时，不继承期货的涨跌或绿灯", () => {
  const card = { status: "green", shortName: "黄金", marketQuote: { price: 5000, instrument: "GC=F", changePct: 2 } };
  applyMacroQuote(card, { price: 4800, change: null, instrument: "XAU-USD-SPOT", source: "Gold API" }, { id: 6, prefix: "$" });
  assert.equal(card.status, "yellow");
  assert.equal(card.marketQuote.comparison, null);
  assert.equal(card.marketQuote.changePct, null);
  assert.doesNotMatch(translateText(card.headline, "en"), /[\u4e00-\u9fff]/);
  assert.doesNotMatch(card.facts.map((text) => translateText(text, "en")).join(" "), /[\u4e00-\u9fff]/);
});
