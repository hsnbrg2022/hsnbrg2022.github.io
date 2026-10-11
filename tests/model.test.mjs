import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeStablecoinHistory } from "../stablecoin-source.js";
import { analyzeTrueMarketMean, calculateBookAccountRatio, calculateDxyFromRates, deriveDashboard, derivePositioningSignal, mergeRefreshView, statusCounts, validateDashboard } from "../model.js";

test("统计九项指标状态", async () => {
  const fixture = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url), "utf8"));
  const cards = fixture.cards.map((card, index) => ({ ...card, status: index < 6 ? "green" : "yellow" }));
  assert.deepEqual(statusCounts(cards), { green: 6, yellow: 3, red: 0, off: 0 });
  const statuses = ["green", "green", "yellow", "yellow", "yellow", "red", "red", "off", "off"];
  assert.deepEqual(statusCounts(cards.map((card, index) => ({ ...card, status: statuses[index] }))), { green: 2, yellow: 3, red: 2, off: 2 });
});

test("生成综合评分、风险和总结", async () => {
  const stableFixture = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url), "utf8"));
  const now = new Date("2026-09-05T08:00:00Z");
  stableFixture.market.fng = 75;
  // This scenario requires a current sentiment observation, not the published snapshot's age.
  stableFixture.market.fngFetchedAt = now.toISOString();
  stableFixture.cards = stableFixture.cards.map((card, index) => ({ ...card, status: index < 6 ? "green" : "yellow" }));
  stableFixture.cards.find((card) => card.id === 9).status = "green";
  stableFixture.cards.find((card) => card.id === 6).status = "yellow";
  stableFixture.cards.forEach((card) => { card.dataAsOf = now.toISOString(); });
  Object.assign(stableFixture.cards.find(card => card.id === 2), { basisAsOf: "2026-08-31", mnavMode: "official-live" });
  stableFixture.cards.find(card => card.id === 3).stablecoin = normalizeStablecoinHistory(["2026-08-28", "2026-09-04"].map((date, i) => ({ date: Date.parse(date) / 1000, totalCirculatingUSD: { peggedUSD: 300e9 + i * 1e9 } })), now);
  const result = deriveDashboard(stableFixture, now);
  assert.equal(result.score, 6);
  assert.equal(result.total, 9);
  assert.equal(result.coverage, 7);
  assert.match(result.summary, /覆盖不完整/);
  assert.ok(result.risks.some((risk) => risk.includes("追高风险")));
});

test("拒绝缺项或非法状态", async () => {
  const fixture = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url), "utf8"));
  assert.equal(validateDashboard(fixture), true);
  assert.throws(() => validateDashboard({ ...fixture, cards: fixture.cards.slice(0, 8) }), /9 项/);
  const bad = structuredClone(fixture);
  bad.cards[0].status = "unknown";
  assert.throws(() => validateDashboard(bad), /状态无效/);
  assert.throws(() => validateDashboard({ ...fixture, trueMarketMean: { value: 0, asOf: "2026-08-21" } }), /True Market Mean/);
});

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
