import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { analyzeTrueMarketMean, calculateBookAccountRatio, calculateDxyFromRates, derivePositioningSignal, mergeRefreshView } from "../model.js";

test("仓帐比只由仓位比和账户比计算", () => {
  assert.equal(calculateBookAccountRatio(1.14, 1.96)?.toFixed(2), "1.72");
  assert.equal(calculateBookAccountRatio(0, 1.96), null);
  assert.equal(calculateBookAccountRatio("", 1.96), null);
});

test("手工多空比自动生成仓帐比与信号等级", () => {
  const signal = derivePositioningSignal(1.07, 1.89);
  assert.equal(signal.positioning.bookAccountRatio.toFixed(2), "1.77");
  assert.equal(signal.status, "green");
  assert.equal(signal.headline, "机构锁仓做多（S+级）");
  assert.match(signal.change, /仓帐比1\.77/);
  assert.equal(derivePositioningSignal(0, 1.8), null);
});

test("使用美元篮子权重推导 DXY", () => {
  const value = calculateDxyFromRates({ EUR: 0.85477, JPY: 158.7, GBP: 0.73228, CAD: 1.374, SEK: 9.4559, CHF: 0.79947 });
  assert.ok(value > 95 && value < 105);
  assert.equal(calculateDxyFromRates({ EUR: 0 }), null);
});

test("True Market Mean 随 BTC 自动判断方向与数据新鲜度", () => {
  const metric = { value: 75689, asOf: "2026-08-21" };
  const support = analyzeTrueMarketMean(78000, metric, new Date("2026-08-23T02:00:00Z"));
  assert.equal(support.relation, "support");
  assert.equal(support.freshness, "fresh");
  assert.equal(support.ageDays, 2);
  assert.equal(analyzeTrueMarketMean(75000, metric, new Date("2026-08-26T02:00:00Z")).relation, "testing");
  assert.equal(analyzeTrueMarketMean(70000, metric, new Date("2026-08-26T02:00:00Z")).relation, "resistance");
  assert.equal(analyzeTrueMarketMean(70000, metric, new Date("2026-08-26T02:00:00Z")).freshness, "aging");
  assert.equal(analyzeTrueMarketMean(70000, metric, new Date("2026-09-01T02:00:00Z")).freshness, "stale");
  assert.equal(analyzeTrueMarketMean(70000, { value: 0, asOf: "2026-08-21" }), null);
});

test("延迟刷新不能覆盖期间保存的 ETF 与多空比，其余行情继续更新", async () => {
  const started = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url), "utf8"));
  const current = structuredClone(started);
  current.updatedAt = "2026-09-05T02:00:00Z";
  current.date = "2026-09-05";
  current.dataMode = "本地维护 + 实时数据";
  current.cards.find((card) => card.id === 1).headline = "手工修正 ETF";
  Object.assign(current.cards.find((card) => card.id === 9), derivePositioningSignal(1, 3));
  const incoming = structuredClone(started);
  incoming.updatedAt = "2026-09-04T23:59:59Z";
  incoming.date = "2026-09-04";
  incoming.market.btcPrice = 80000;
  incoming.cards.find((card) => card.id === 3).headline = "新稳定币数据";
  const result = mergeRefreshView(current, started, incoming);
  assert.equal(result.cards.find((card) => card.id === 1).headline, "手工修正 ETF");
  assert.equal(result.cards.find((card) => card.id === 9).positioning.bookAccountRatio, 3);
  assert.equal(result.cards.find((card) => card.id === 3).headline, "新稳定币数据");
  assert.equal(result.market.btcPrice, 80000);
  assert.equal(result.updatedAt, current.updatedAt);
  assert.equal(result.date, current.date);
  assert.equal(result.dataMode, current.dataMode);
});
