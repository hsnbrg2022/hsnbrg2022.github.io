import test from "node:test";
import assert from "node:assert/strict";
import { applyMacroQuote } from "../macro-quote.js";
import { translateText } from "../i18n.js";

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
