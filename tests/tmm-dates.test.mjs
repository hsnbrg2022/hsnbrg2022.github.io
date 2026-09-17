import test from "node:test";
import assert from "node:assert/strict";
import { calculateTrueMarketMean } from "../scripts/update-true-market-mean.mjs";
import { applyTrueMarketMeanDataset, validateTrueMarketMeanDataset } from "../true-market-mean.js";
import { analyzeTrueMarketMean } from "../model.js";
const now = new Date("2026-09-13T00:00:00Z"), day = 86400;
const yesterday = Date.parse("2026-09-12T00:00:00Z") / 1000;
const rows = timestamp => ({ avivRows: [{ timestamp, value: 1 }], priceRows: [{ timestamp, value: 75000 }], now });
const fixture = () => calculateTrueMarketMean(rows(yesterday));

test("TMM跳过当天未完成样本，选择两指标相同的最新完整UTC日", () => {
  const input = rows(yesterday);
  for (const series of [input.avivRows, input.priceRows]) {
    series.unshift({ timestamp: yesterday + day, value: series[0].value * 1.05 });
    series.push({ ...series.at(-1) });
  }
  assert.equal(calculateTrueMarketMean(input).asOf, "2026-09-12");
  assert.throws(() => calculateTrueMarketMean(rows(yesterday + day)), /完整/);
});

test("TMM非法/未来/非日界时间戳与冲突重复拒绝，不依赖Map最后一条覆盖", () => {
  for (const timestamp of [null, "", "  ", false, NaN, Infinity, 1e30, yesterday + 0.1, yesterday + 3600, yesterday + 2 * day]) {
    assert.throws(() => calculateTrueMarketMean(rows(timestamp)), /时间|日期/);
  }
  for (const key of ["avivRows", "priceRows"]) {
    const input = rows(yesterday);
    input[key].push({ timestamp: yesterday, value: input[key][0].value + 1 });
    assert.throws(() => calculateTrueMarketMean(input), /重复/);
  }
});

test("TMM快照载入拒绝当天、未来、非法日历日期及非午夜时间戳，旧值原样保留", () => {
  const valid = fixture();
  const bad = [
    { ...valid, asOf: "2026-02-30" },
    { ...valid, asOf: "2026-09-13", inputs: { ...valid.inputs, timestamp: yesterday + day } },
    { ...valid, asOf: "2026-09-14", inputs: { ...valid.inputs, timestamp: yesterday + 2 * day } },
    ...[null, "", false, 1e30, yesterday + 3600].map(timestamp => ({ ...valid, inputs: { ...valid.inputs, timestamp } }))
  ];
  for (const candidate of bad) {
    const data = { trueMarketMean: { value: 74000, asOf: "2026-09-11" } }, before = structuredClone(data);
    assert.throws(() => applyTrueMarketMeanDataset(data, candidate, { now }));
    assert.deepEqual(data, before);
  }
});

test("TMM第三个UTC日有效，第四日失效；UTC+8换日不提前改变年龄", () => {
  const valid = fixture();
  const third = new Date("2026-09-15T23:59:59.999Z");
  assert.equal(validateTrueMarketMeanDataset(valid, { now: third }).ageDays, 3);
  assert.equal(analyzeTrueMarketMean(76000, valid, third).ageDays, 3);
  assert.throws(() => validateTrueMarketMeanDataset(valid, { now: new Date("2026-09-16T00:00:00Z") }), /滞后 4 天/);
  assert.equal(analyzeTrueMarketMean(76000, valid, third).freshness, "fresh");
});

test("TMM旧看板的未完成/未来/非法日期保留数值但标待核验，不冒充当前参考位", () => {
  for (const asOf of ["2026-09-13", "2026-09-14", "2026-02-30", "2026-13-01", "invalid", null]) {
    const result = analyzeTrueMarketMean(76000, { value: 75000, asOf }, now);
    assert.equal(result.value, 75000);
    assert.equal(result.freshness, "unknown");
    assert.equal(result.relation, "pending");
  }
});
