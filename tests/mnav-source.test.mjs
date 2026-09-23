import test from "node:test";
import assert from "node:assert/strict";
import { applyStrategyMnavDataset, strategyMnavBusinessDaysSince, validateStrategyMnavDataset, updateMnavFromSnapshot, mnavHealthRows } from "../mnav-source.js";
import { parseOfficialApiQuote } from "../scripts/update-strategy-mnav.mjs";
import { cardQuality } from "../data-quality.js";
import { translateText, t } from "../i18n.js";

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

test("资本基准第七天可确认，第八天仍展示官方读数但不确认；拒绝估算", () => {
  const now = new Date("2026-09-07T04:00:00Z");
  assert.equal(validateStrategyMnavDataset(dataset, { now }).mnav, 1.15);
  for (const [patch, reason] of [
    [{ basisAsOf: "2026-08-30" }, /mnavBasisStale/],
    [{ basisAsOf: "2026-02-30" }, /mnavBasisUnknown/],
    [{ basisAsOf: "2026-09-08" }, /mnavBasisUnknown/],
    [{ basisComplete: false }, /mnavBasisIncomplete/]
  ]) {
    const data = { cards: [{ id: 2, headline: "old", status: "green" }] };
    applyStrategyMnavDataset(data, { ...dataset, ...patch }, { now });
    assert.match(data.cards[0].headline, /1.15x/);
    assert.equal(cardQuality(data.cards[0], now).eligible, false);
    assert.match(cardQuality(data.cards[0], now).reason, reason);
  }
  for (const [patch, reason] of [
    [{ marketAsOf: "2026-09-08" }, /行情日期无效/],
    [{ calculation: { mode: "official-methodology-estimate" }, validation: { basisClassification: "verified" } }, /mnavClassificationUnknown/]
  ]) {
    const data = { cards: [{ id: 2, headline: "old", status: "green" }] };
    const before = structuredClone(data);
    assert.throws(() => applyStrategyMnavDataset(data, { ...dataset, ...patch }, { now }), reason);
    assert.deepEqual(data, before);
  }
});

const apiNow = new Date("2026-09-22T20:04:00Z");
const stock = [{ company: "MSTR", ufPrice: 167.33, msTimeStamp: Date.parse("2026-09-22T20:00:00Z"), extendedSession: { ufPrice: 9000 } }];
const btc = { results: { mNav: 1.2228, netBtcPerShareUsd: 136.8648, ufPrice: 86223.75, msTimestamp: Date.parse("2026-09-22T20:03:21.449Z"), extendedSession: { mNav: 9 } } };

test("官方 API 使用正常盘直接读数与明确时间，不混入盘后或美元净储备", () => {
  const q = parseOfficialApiQuote(stock, btc, { now: apiNow });
  assert.equal(q.mnav, 1.2228);
  assert.equal(q.mstrPriceUsd, 167.33);
  assert.equal(q.netBtcPerShareUsd, 136.8648);
  assert.equal(q.marketAsOf, "2026-09-22");
  assert.equal(q.netBtc, null);
  assert.equal(q.btcObservedAt, "2026-09-22T20:03:21.449Z");
  const nextDay = new Date("2026-09-23T10:00:00Z");
  const offHours = parseOfficialApiQuote(stock, { results: { ...btc.results, msTimestamp: nextDay.getTime() } }, { now: nextDay });
  assert.equal(offHours.marketAsOf, "2026-09-22");
  assert.equal(offHours.btcObservedAt, nextDay.toISOString());
});

test("官方 API 拒绝缺字段、错资产、未来时间与超过两交易日的读数", () => {
  for (const [s, b] of [
    [[], btc], [[{ ...stock[0], company: "OTHER" }], btc],
    [[stock[0], stock[0]], btc], [stock, { results: { ...btc.results, mNav: null } }],
    [stock, { results: { ...btc.results, ufPrice: "86223.75" } }],
    [[{ ...stock[0], msTimeStamp: null }], btc],
    [stock, { results: { ...btc.results, msTimestamp: apiNow.getTime() + 1 } }],
    [[{ ...stock[0], msTimeStamp: Date.parse("2026-09-16T20:00:00Z") }], btc]
  ]) assert.throws(() => parseOfficialApiQuote(s, b, { now: apiNow }));
});

test("资本待核验中英文提示不再把新官方行情称为旧值", () => {
  const data = { cards: [{ id: 2 }] };
  applyStrategyMnavDataset(data, { ...dataset, basisAsOf: null, basisComplete: false }, { now: new Date("2026-09-04T08:00:00Z") });
  for (const fact of data.cards[0].facts) assert.doesNotMatch(translateText(fact, "en"), /[\u4e00-\u9fff]/);
  for (const key of ["mnavBasisUnknown", "mnavBasisStale", "mnavBasisIncomplete"]) {
    assert.doesNotMatch(t("en", key), /Previous value|[\u4e00-\u9fff]/);
    assert.match(t("en", key), /not counted/);
  }
});

test("公开 mNAV 刷新选择仓库较新快照，不依赖 Pages 重建", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const data = { cards: [{ id: 2 }] };
  await updateMnavFromSnapshot(data, async url => ({ ok: true, json: async () => ({ ...dataset, basisComplete: false, marketAsOf: url.startsWith("https:") ? "2026-09-04" : "2026-09-03" }) }));
  assert.equal(data.cards[0].dataAsOf, "2026-09-04");
  assert.equal(cardQuality(data.cards[0]).eligible, false);
});

test("仓库读取失败可回退站点；全失败与公式错误不覆盖原卡", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const data = { cards: [{ id: 2 }] };
  await updateMnavFromSnapshot(data, async url => {
    if (url.startsWith("https:")) throw new Error("offline");
    return { ok: true, json: async () => dataset };
  });
  const before = structuredClone(data);
  await assert.rejects(updateMnavFromSnapshot(data, async () => ({ ok: true, json: async () => ({ ...dataset, mnav: 8 }) })), /公式/);
  assert.equal(data.cards[0].mnavReadCheck.status, "failed");
  data.cards[0].mnavReadCheck = before.cards[0].mnavReadCheck;
  assert.deepEqual(data, before);
});

test("未来或非法快照生成时间不能参与择新", () => {
  for (const generatedAt of [null, "invalid", "2026-09-05T00:00:00Z"]) {
    assert.throws(() => validateStrategyMnavDataset({ ...dataset, generatedAt }, { now: new Date("2026-09-04T08:00:00Z") }), /快照时间/);
  }
});

test("更新状态区分行情、快照生成及读取检查，不推断后台运行时间", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const data = { cards: [{ id: 2 }] };
  await updateMnavFromSnapshot(data, async () => ({ ok: true, json: async () => dataset }));
  const target = data.cards[0];
  const rows = Object.fromEntries(mnavHealthRows(target).map(([key, value, fallback]) => [key, value ?? fallback ?? "healthUnknown"]));
  assert.equal(rows.healthMarketDate, "2026-09-03");
  assert.equal(rows.healthSnapshotCreated, "04/09/2026, 10:00:00");
  assert.equal(rows.healthReadCheck, "04/09/2026, 16:00:00");
  assert.equal(rows.healthReadStatus, "healthReadOk");
  for (const key of ["healthBackendCheck", "healthBackendSuccess", "healthBackendError"]) assert.equal(rows[key], "healthNotConnected");
  assert.equal(mnavHealthRows({ ...target, mnavSnapshotAt: undefined, lastRefreshAt: "2026-09-04T08:00:00Z" }).find(row => row[0] === "healthSnapshotCreated")[1], null);
});

test("失败检查不翻新快照时间；未知状态如实展示；全部标签适配双语", async context => {
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-09-04T08:00:00Z") });
  const data = { cards: [{ id: 2 }] };
  applyStrategyMnavDataset(data, dataset);
  const snapshotAt = data.cards[0].mnavSnapshotAt;
  await assert.rejects(updateMnavFromSnapshot(data, async () => { throw new Error("HTTP 403"); }));
  assert.equal(data.cards[0].mnavSnapshotAt, snapshotAt);
  assert.equal(data.cards[0].headline, "1.15x · MSTR $144.82");
  const rows = mnavHealthRows(data.cards[0]);
  assert.equal(rows.find(row => row[0] === "healthReadError")[1], "HTTP 403");
  for (const [label, , fallback] of [...rows, ...mnavHealthRows({})]) for (const key of [label, fallback].filter(Boolean)) {
    assert.notEqual(t("zh", key), key);
    assert.notEqual(t("en", key), key);
    assert.doesNotMatch(t("en", key), /[\u4e00-\u9fff]/);
  }
});
