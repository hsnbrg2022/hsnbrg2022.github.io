import test from "node:test";
import assert from "node:assert/strict";
import { normalizeStablecoinHistory, stablecoinQuality } from "../stablecoin-source.js";

const now = new Date("2026-09-09T02:00:00Z");
const row = (date, total) => ({ date: String(Date.parse(`${date}T00:00:00Z`) / 1000), totalCirculatingUSD: { peggedUSD: total } });
const rows = [row("2026-09-01", 300e9), row("2026-09-08", 293.16e9)];

test("七日按实际 UTC 日期而非行数；乱序、相同重复、缺中间日期不改变端点比较", () => {
  const reading = normalizeStablecoinHistory(rows, now);
  assert.equal(reading.change.toFixed(2), "-2.28");
  assert.deepEqual(normalizeStablecoinHistory([rows[1], rows[0], rows[1]], now), reading);
  assert.throws(() => normalizeStablecoinHistory([row("2026-08-01", 300e9), rows[1]], now), /seven-day/);
  assert.throws(() => normalizeStablecoinHistory([rows[0], row("2026-09-07", 310e9)], now), /seven-day/);
});

test("冲突、未来、非日界线、无效金额拒绝；已验证读数仍遵循三天边界", () => {
  for (const bad of [[...rows, row("2026-09-08", 100)], [...rows, row("2030-01-01", 300e9)],
    [rows[0], { ...rows[1], date: Number(rows[1].date) + 1 }], [rows[0], row("2026-09-08", 0)], [row("2026-09-01", null), rows[1]]]) {
    assert.throws(() => normalizeStablecoinHistory(bad, now));
  }
  const reading = normalizeStablecoinHistory(rows, now);
  const boundary = Date.parse(reading.asOf) + 3 * 86400000;
  assert.equal(stablecoinQuality(reading, new Date(boundary)).eligible, true);
  assert.equal(stablecoinQuality(reading, new Date(boundary + 1)).state, "stale");
  assert.equal(stablecoinQuality({ ...reading, change: 1 }, now).eligible, false);
  assert.equal(stablecoinQuality({ ...reading, period: "24h" }, now).eligible, false);
  assert.equal(stablecoinQuality({ ...reading, universe: "all" }, now).eligible, false);
});
