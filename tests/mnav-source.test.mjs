import test from "node:test";
import assert from "node:assert/strict";
import { applyStrategyMnavDataset, strategyMnavBusinessDaysSince, validateStrategyMnavDataset } from "../mnav-source.js";

const dataset = {
  schemaVersion: 1,
  status: "active",
  generatedAt: "2026-09-04T02:00:00Z",
  marketAsOf: "2026-09-03",
  basisAsOf: "2026-08-31",
  mnav: 1.15,
  formula: "mstr_price_usd / net_btc_per_share_usd",
  methodologyEffectiveDate: "2026-07-23",
  calculation: { mode: "official-live" },
  inputs: {
    mstrPriceUsd: 144.82,
    btcPriceUsd: 80_859.99,
    netBtcPerShareUsd: 126.1,
    netBtc: 661_982.56,
    btcHoldings: 845_050,
    usdAssetsUsd: 6_714_000_000,
    seniorClaimsUsd: 21_516_830_700,
    fullyDilutedShares: 424_479_000
  },
  source: { url: "https://www.strategy.com/btc" }
};

test("官方直接 mNAV 快照通过公式校验并更新卡片", () => {
  const dashboard = { cards: [{ id: 2, headline: "old", status: "yellow" }], previous: { changes: ["② mNAV：old"] } };
  assert.equal(validateStrategyMnavDataset(dataset, { now: new Date("2026-09-04T02:00:00Z") }).mnav, 1.15);
  const message = applyStrategyMnavDataset(dashboard, dataset, { now: new Date("2026-09-04T02:00:00Z") });
  const target = dashboard.cards.find((item) => item.id === 2);
  assert.equal(target.title, "Strategy mNAV");
  assert.match(target.headline, /1\.15x · MSTR \$144\.82/);
  assert.deepEqual(target.facts.slice(0, 2), ["Net BPS $126.10", "净 BTC 661,983"]);
  assert.equal(target.mnavMode, "official-live");
  assert.equal(target.status, "green");
  assert.equal(target.refresh, "auto");
  assert.match(message, /Strategy 官方看板/);
});

test("拒绝旧 EV 口径、公式错误与过期行情", () => {
  assert.throws(() => validateStrategyMnavDataset({ ...dataset, formula: "enterprise_value / btc_nav" }), /新口径/);
  assert.throws(() => validateStrategyMnavDataset({ ...dataset, mnav: 1.5 }, { now: new Date("2026-09-04T02:00:00Z") }), /公式校验失败/);
  assert.throws(() => validateStrategyMnavDataset({ ...dataset, basisAsOf: "2026-09-08" }, { now: new Date("2026-09-10T12:00:00Z") }), /滞后/);
});

test("mNAV 行情年龄按美股交易日计算", () => {
  assert.equal(strategyMnavBusinessDaysSince("2026-09-03", new Date("2026-09-06T12:00:00Z")), 1);
  assert.equal(strategyMnavBusinessDaysSince("2026-09-03", new Date("2026-09-09T12:00:00Z")), 3);
});

test("资本基准第七天可用，第八天停用；无效日期和未核验估算不覆盖旧值", () => {
  const now = new Date("2026-09-07T04:00:00Z");
  assert.equal(validateStrategyMnavDataset(dataset, { now }).mnav, 1.15);
  for (const [patch, reason] of [
    [{ basisAsOf: "2026-08-30" }, /mnavBasisStale/],
    [{ basisAsOf: "2026-02-30" }, /mnavBasisUnknown/],
    [{ basisAsOf: "2026-09-08" }, /mnavBasisUnknown/],
    [{ marketAsOf: "2026-09-08" }, /行情日期无效/],
    [{ calculation: { mode: "official-methodology-estimate" }, validation: { basisClassification: "verified" } }, /mnavClassificationUnknown/]
  ]) {
    const data = { cards: [{ id: 2, headline: "old", status: "green" }] };
    const before = structuredClone(data);
    assert.throws(() => applyStrategyMnavDataset(data, { ...dataset, ...patch }, { now }), reason);
    assert.deepEqual(data, before);
  }
});
