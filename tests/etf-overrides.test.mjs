import test from "node:test";
import assert from "node:assert/strict";
import { ETF_STORAGE_KEY, ETF_LEGACY_KEY, emptyEtfEdits, readEtfEdits, saveEtfEdit, mergeEtfEdits, migrateEtfSelection } from "../etf-overrides.js";
const now = new Date("2026-09-05T08:00:00Z");
const base = { asset: "BTC", unit: "USD_MILLIONS", status: "snapshot", generatedAt: "2026-09-03T08:00:00Z", marketDate: "2026-09-02", source: { label: "Farside" }, rows: [{ date: "2026-09-01", flowUsdMillions: 100 }, { date: "2026-09-02", flowUsdMillions: 200 }] };

test("只保存实际修改日期，新发布日期及未修改的纠错仍同步进入", () => {
  const state = saveEtfEdit(emptyEtfEdits(), base, { date: "2026-09-01", flowUsdMillions: "150" }, now);
  const newer = { ...base, rows: [base.rows[0], { date: "2026-09-02", flowUsdMillions: 210 }, { date: "2026-09-04", flowUsdMillions: -50 }] };
  const merged = mergeEtfEdits(newer, state);
  assert.deepEqual(merged.rows.map((row) => row.flowUsdMillions), [150, 210, -50]);
  assert.equal(merged.marketDate, "2026-09-04");
  assert.equal(state.edits.length, 1);
  assert.deepEqual(mergeEtfEdits(newer, emptyEtfEdits()).rows, newer.rows);
  assert.equal(base.rows[0].flowUsdMillions, 100);
});

test("个人同日二次修改不重复；发布同日更正显式标为冲突，个人值不静默丢失", () => {
  let state = saveEtfEdit(emptyEtfEdits(), base, { date: "2026-09-01", flowUsdMillions: 150 }, now);
  state = saveEtfEdit(state, base, { date: "2026-09-01", flowUsdMillions: 180 }, now);
  const merged = mergeEtfEdits({ ...base, rows: [{ date: "2026-09-01", flowUsdMillions: 120 }, base.rows[1]] }, state);
  assert.equal(state.edits.length, 1);
  assert.equal(state.edits[0].baseValue, 100);
  assert.deepEqual(merged.browserConflicts, ["2026-09-01"]);
  assert.equal(merged.rows[0].flowUsdMillions, 180);
});

test("旧缓存不自动变成全日期覆盖，仅迁移明确勾选日期且不改变旧副本", () => {
  const legacy = structuredClone(base);
  legacy.rows[0].flowUsdMillions = 160;
  const original = JSON.stringify(legacy);
  const storage = new Map([[ETF_LEGACY_KEY, original]]);
  const state = readEtfEdits({ getItem: (key) => storage.get(key) });
  assert.equal(state.edits.length, 0);
  const selected = migrateEtfSelection(state, base, legacy, ["2026-09-01"], now);
  assert.equal(selected.edits.length, 1);
  assert.equal(selected.legacyReviewed, true);
  assert.equal(JSON.stringify(legacy), original);
  assert.equal(migrateEtfSelection(state, base, legacy, [], now).edits.length, 0);
  assert.throws(() => migrateEtfSelection(state, base, legacy, ["2026-08-31"], now));
});

test("损坏或重复编辑缓存拒绝使用且不调用删除", () => {
  assert.throws(() => readEtfEdits({ getItem: () => "invalid", removeItem: () => assert.fail("must not delete") }));
  const state = saveEtfEdit(emptyEtfEdits(), base, { date: "2026-09-01", flowUsdMillions: 150 }, now);
  state.edits.push(state.edits[0]);
  assert.throws(() => readEtfEdits({ getItem: (key) => key === ETF_STORAGE_KEY ? JSON.stringify(state) : null }));
});
