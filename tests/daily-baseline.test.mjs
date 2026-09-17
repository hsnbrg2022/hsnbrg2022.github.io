import test from "node:test";
import assert from "node:assert/strict";
import { DAILY_BASELINE_KEY, beijingDay, dailyBaselineView, saveDailyBaseline } from "../daily-baseline.js";

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
const data = time => ({ previous: { date: "2026-08-21", btcPrice: 12345, fng: 80 }, market: {
  btcPrice: 75000, btcCurrency: "USD", btcObservedAt: time, fng: 50, fngFetchedAt: time
} });

test("Beijing midnight picks yesterday, never an older or same-day snapshot", () => {
  const store = storage(), time = "2026-09-15T15:59:59.000Z";
  saveDailyBaseline(store, data(time), new Date(time));
  assert.equal(beijingDay(new Date(time)), "2026-09-15");
  assert.equal(dailyBaselineView(data(time), store, new Date(time)).previous.baselineStatus, "missing");
  const midnight = dailyBaselineView(data(time), store, new Date("2026-09-15T16:00:00Z"));
  assert.equal(midnight.previous.date, "2026-09-15");
  assert.equal(midnight.previous.btcPrice, 75000);
  assert.equal(dailyBaselineView(data(time), store, new Date("2026-09-16T16:00:00Z")).previous.baselineStatus, "missing");
});

test("last completed snapshot wins; stale or unknown readings at capture are excluded", () => {
  const store = storage(), time = "2026-09-15T10:00:00.000Z";
  saveDailyBaseline(store, data(time), new Date(time));
  const later = data(time); later.market.btcPrice = 76000;
  later.market.fngFetchedAt = "2026-09-10T00:00:00Z";
  saveDailyBaseline(store, later, new Date("2026-09-15T11:00:00Z"));
  const previous = dailyBaselineView(later, store, new Date("2026-09-16T01:00:00Z")).previous;
  assert.equal(previous.capturedAt, "2026-09-15T11:00:00.000Z");
  assert.equal(previous.btcPrice, undefined);
  assert.equal(previous.fng, undefined);
  assert.equal(JSON.parse(store.getItem(DAILY_BASELINE_KEY)).rows.length, 1);
});

test("missing, corrupt or denied storage never falls back to legacy example data", () => {
  const store = storage(), now = new Date("2026-09-16T01:00:00Z"), source = data(now.toISOString());
  assert.equal(dailyBaselineView(source, store, now).previous.btcPrice, undefined);
  store.setItem(DAILY_BASELINE_KEY, "broken");
  assert.equal(dailyBaselineView(source, store, now).previous.baselineStatus, "unavailable");
  assert.throws(() => saveDailyBaseline(store, source, now));
  assert.equal(store.getItem(DAILY_BASELINE_KEY), "broken");
  const denied = { getItem() { throw Error("denied"); } };
  assert.equal(dailyBaselineView(source, denied, now).previous.baselineStatus, "unavailable");
  assert.equal(source.previous.btcPrice, 12345);
});

test("rejects future or date-mismatched history and retains at most seven days", () => {
  const store = storage();
  for (let i = 1; i <= 10; i++) {
    const time = `2026-09-${String(i).padStart(2, "0")}T10:00:00.000Z`;
    saveDailyBaseline(store, data(time), new Date(time));
  }
  assert.equal(JSON.parse(store.getItem(DAILY_BASELINE_KEY)).rows.length, 7);
  store.setItem(DAILY_BASELINE_KEY, JSON.stringify({ version: 1, rows: [
    { day: "2026-09-15", savedAt: "2026-09-20T00:00:00Z", market: data("2026-09-15T00:00:00Z").market },
    { day: "2026-09-15", savedAt: "2026-09-14T00:00:00Z", market: data("2026-09-14T00:00:00Z").market }
  ] }));
  assert.equal(dailyBaselineView({}, store, new Date("2026-09-16T01:00:00Z")).previous.baselineStatus, "missing");
});
