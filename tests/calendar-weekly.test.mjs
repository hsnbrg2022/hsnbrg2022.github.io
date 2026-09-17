import test from "node:test";
import assert from "node:assert/strict";
import { isTradingDay, nextTradingDay, tradingDaysSince } from "../trading-calendar.js";
import { normalizeEtfRows, summarizeEtfFlows, etfSignal } from "../etf-core.js";
import { calculate200WeekMean, currentWeekStart, updateWeeklyMean, validateWeeklySnapshot, WEEKLY_RULE } from "../weekly-mean.js";
import { nextEtfTradingDate, upsertManualEtfFlow } from "../scripts/manual-etf-flow.mjs";
const now = new Date("2026-09-05T08:00:00Z"), week = 604800;
const end = currentWeekStart(now);
const rows = Array.from({ length: 200 }, (_, i) => ({ timestamp: end - (200 - i) * week, close: 100 + i }));

test("休市日跨周连续，提前收市仍算交易日，越出日历范围不猜测", () => {
  assert.equal(nextTradingDay("2026-09-04"), "2026-09-08");
  assert.equal(isTradingDay("2026-11-27"), true);
  assert.equal(isTradingDay("2027-06-18"), false);
  assert.equal(isTradingDay("2027-12-31"), true);
  assert.equal(isTradingDay("2029-01-02"), null);
  assert.equal(tradingDaysSince("2026-09-04", new Date("2026-09-08T08:00:00Z")), 1);
  assert.equal(nextEtfTradingDate("2026-09-04", new Date("2026-09-08T08:00:00Z")), "2026-09-08");
  assert.throws(() => upsertManualEtfFlow({}, { date: "2026-09-07", flowUsdMillions: 10 }, new Date("2026-09-08")), /休市/);
});

test("ETF 缺日后重新计数，不把零值当缺失；相同重复去重、冲突重复拒绝", () => {
  const s = summarizeEtfFlows([{ date: "2026-08-03", flowUsdMillions: 100 }, { date: "2026-08-27", flowUsdMillions: 200 }, { date: "2026-08-28", flowUsdMillions: 300 }]);
  assert.equal(s.streak, 2); assert.equal(s.cumulative, 500); assert.equal(s.gapAfter, "2026-08-03");
  assert.equal(summarizeEtfFlows([{ date: "2026-08-27", flowUsdMillions: 0 }, { date: "2026-08-28", flowUsdMillions: 100 }]).streak, 1);
  const record = { date: "2026-08-28", flowUsdMillions: 0 };
  assert.equal(normalizeEtfRows([record, record]).length, 1);
  for (const value of [null, undefined, "", NaN]) assert.throws(() => normalizeEtfRows([{ ...record, flowUsdMillions: value }]));
  assert.throws(() => normalizeEtfRows([record, { ...record, flowUsdMillions: 10 }]));
  assert.throws(() => normalizeEtfRows([{ date: "2026-02-30", flowUsdMillions: 1 }]));
  assert.equal(summarizeEtfFlows([{ date: "2026-09-04", flowUsdMillions: 10 }, { date: "2026-09-08", flowUsdMillions: 20 }]).streak, 2);
  assert.match(etfSignal({ rows: [{ date: "2026-08-03", flowUsdMillions: 1 }, { date: "2026-08-28", flowUsdMillions: 1 }] }).detail, /缺少交易日/);
});

test("200WMA 仅使用完整 UTC 周一窗口，忽略当前周和窗口之外的旧值", () => {
  const result = calculate200WeekMean([...rows, { timestamp: end, close: 999999 }, { timestamp: end + 12345, close: 999999 }], now);
  assert.equal(result.value, 199.5);
  assert.equal(result.sampleCount, 200);
  assert.equal(calculate200WeekMean([...rows].reverse(), now).value, 199.5);
  assert.equal(calculate200WeekMean([...rows, rows[0]], now).value, 199.5);
  assert.equal(result.asOf, "2026-08-30T23:59:59.999Z");
});

test("190/199 周、缺中间周、周四口径、无时间戳及非法收盘价均拒绝", () => {
  for (const input of [rows.slice(1), rows.slice(10), rows.filter((_, i) => i !== 100), rows.map((r) => ({ ...r, timestamp: r.timestamp + 3 * 86400 })), rows.map((r) => ({ close: r.close })), [...rows.slice(1), { ...rows[0], close: 0 }], [...rows, { ...rows[0], close: 99 }]]) assert.throws(() => calculate200WeekMean(input, now));
});

test("周线主接口不合格时尝试备用接口，全部失败保留值并明确失败", async () => {
  const data = { market: { btcPrice: 400, wma200: 123, wmaRatio: 3 } };
  const good = { chart: { result: [{ timestamp: rows.map((r) => r.timestamp), indicators: { quote: [{ close: rows.map((r) => r.close) }] } }] } };
  const calls = [];
  await updateWeeklyMean(data, async (url) => { calls.push(url); return { ok: true, json: async () => url.includes("query1") ? { chart: {} } : good }; }, now);
  assert.equal(calls.length, 2); assert.equal(data.market.wma200, 199.5);
  const before = structuredClone(data.market.wmaObservation);
  await assert.rejects(() => updateWeeklyMean(data, async () => { throw new Error("offline"); }, now));
  assert.equal(data.market.wma200, 199.5); assert.equal(data.market.wmaRefreshStatus, "failed");
  assert.deepEqual(data.market.wmaObservation, before);
});

test("公开同源快照按 200 条原始周线重算，跨周旧快照和篡改值拒绝", async () => {
  const dataset = { schemaVersion: 1, ...calculate200WeekMean(rows, now), rule: WEEKLY_RULE, source: { label: "Yahoo Finance" }, generatedAt: now.toISOString(), rows };
  assert.equal(validateWeeklySnapshot(dataset, now).value, 199.5);
  assert.throws(() => validateWeeklySnapshot({ ...dataset, value: 200 }, now));
  assert.throws(() => validateWeeklySnapshot(dataset, new Date("2026-09-07T08:00:00Z")));
  const data = { market: { btcPrice: 400 } };
  const calls = [];
  await updateWeeklyMean(data, async (url) => { calls.push(url); return { ok: true, json: async () => dataset }; }, now, { snapshotFirst: true });
  assert.equal(calls.length, 1); assert.match(calls[0], /weekly-mean.json/);
  assert.equal(data.market.wmaObservation.sampleCount, 200);
});
