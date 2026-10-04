import test from "node:test";
import assert from "node:assert/strict";
import { FREE_ONCHAIN, FREE_TMM, parseOnchainLabRows, parseChartRows, fetchFreeRows } from "../free-onchain-source.js";
import { buildOnchainDataset, fetchOnchainDataset } from "../scripts/update-onchain.mjs";
import { buildPublishedTrueMarketMean } from "../scripts/update-true-market-mean.mjs";
import { applyOnchainDataset, validateOnchainDataset } from "../onchain-source.js";
import { applyTrueMarketMeanDataset, validateTrueMarketMeanDataset, updateTrueMarketMeanFromSnapshot } from "../true-market-mean.js";
import { translateText } from "../i18n.js";

const now = new Date("2026-10-04T08:00:00Z"), date = "2026-10-03";
const timestamp = Date.parse(date + "T00:00:00Z") / 1000;
const plot = traces => `<script>Plotly.newPlot("chart", ${JSON.stringify(traces)}, {}); globalThis.mustNotRun = true;</script>`;
const trace = (name, value = 1) => ({ name, x: [date + "T00:00:00"], y: [value] });

test("免费 MVRV 仅接受指定指标、合法日期与匹配的来源日期，不用读取时间造日期", () => {
  const payload = { key: "mvrv_zscore", as_of: date, series: [[date, 1.0537]] };
  assert.deepEqual(parseOnchainLabRows(payload), [{ timestamp, value: 1.0537 }]);
  for (const patch of [{ key: "mvrv" }, { as_of: "2026-10-02" }, { series: [["2026-02-30", 1]] }, { series: [[date, null]] }]) assert.throws(() => parseOnchainLabRows({ ...payload, ...patch }));
});

test("公开图表精确匹配系列，安全解码 float64，不执行网页脚本", () => {
  const bytes = Buffer.alloc(8); bytes.writeDoubleLE(0.9892);
  const item = { ...trace("Puell Multiple"), y: { dtype: "f8", bdata: bytes.toString("base64") } };
  assert.deepEqual(parseChartRows(plot([trace("Price", 84000), item]), "Puell Multiple", now), [{ timestamp, value: 0.9892 }]);
  assert.equal(globalThis.mustNotRun, undefined);
  for (const traces of [[trace("Puell Multiple 30d")], [item, item], [{ ...item, y: { dtype: "i4", bdata: "AAAA" } }], [{ ...item, y: [null] }]]) assert.throws(() => parseChartRows(plot(traces), "Puell Multiple", now));
  assert.throws(() => parseChartRows("Plotly.newPlot('x', [malicious()], {});", "Puell Multiple", now));
});

test("免费主指标拒绝未知源和异日辅助值，不冒充 Glassnode，阈值不变且双语", () => {
  for (const id of [7, 8]) {
    const dataset = buildOnchainDataset(id, [{ timestamp, value: 1 }], [], now, FREE_ONCHAIN[id]);
    validateOnchainDataset(dataset, id, { now });
    assert.throws(() => validateOnchainDataset({ ...dataset, source: { ...dataset.source, endpoint: "https://example.test/" } }, id, { now }), /source/);
    assert.throws(() => validateOnchainDataset({ ...dataset, auxiliary: { metric: id === 7 ? "mvrv" : "sopr", timestamp, value: 1 } }, id, { now }), /auxiliary/);
    const data = { cards: [{ id, facts: ["old SOPR"], headline: "old" }] };
    applyOnchainDataset(data, dataset, id, { now });
    const card = data.cards[0]; assert.equal(card.status, "yellow"); assert.equal(card.source.label, FREE_ONCHAIN[id].label);
    assert.doesNotMatch(card.facts.join(), /old SOPR/);
    for (const fact of card.facts) assert.doesNotMatch(translateText(fact, "en"), /[\u4e00-\u9fff]/);
  }
});

test("TMM直接读数不伪造AVIV或收盘价，保留日期、范围、跳变及倒退保护", () => {
  const dataset = buildPublishedTrueMarketMean([{ timestamp, value: 77380.53296397412 }], { now, previous: { asOf: "2026-09-29", value: 77220.19 } });
  assert.equal(dataset.value, 77380.53); assert.equal(dataset.formula, "published_true_market_mean"); assert.equal(dataset.inputs, undefined);
  validateTrueMarketMeanDataset(dataset, { now });
  for (const patch of [{ metric: "realized_price" }, { value: 77000 }, { source: { ...FREE_TMM, endpoint: "https://example.test" } }]) assert.throws(() => validateTrueMarketMeanDataset({ ...dataset, ...patch }, { now }));
  assert.throws(() => buildPublishedTrueMarketMean([{ timestamp, value: 100000 }], { now, previous: { value: 77220 } }), /10%/);
  const data = { trueMarketMean: { value: 78000, asOf: "2026-10-03" } }, before = structuredClone(data);
  assert.throws(() => applyTrueMarketMeanDataset(data, { ...dataset, asOf: "2026-10-02", observation: { ...dataset.observation, timestamp: timestamp - 86400 } }, { now }), /回退/);
  assert.deepEqual(data, before);
});

test("三项免费数据只选已完成UTC日，三天边界不放宽，冲突重复不静默覆盖", () => {
  const rows = [{ timestamp: timestamp + 86400, value: 80000 }, { timestamp, value: 77380 }];
  assert.equal(buildPublishedTrueMarketMean(rows, { now }).asOf, date);
  assert.throws(() => buildPublishedTrueMarketMean([rows[0]], { now }), /完整/);
  assert.throws(() => buildPublishedTrueMarketMean([rows[1], { timestamp, value: 77381 }], { now }), /重复/);
  const tmm = buildPublishedTrueMarketMean(rows, { now });
  const mvrv = buildOnchainDataset(7, [{ timestamp, value: 1 }], [], now, FREE_ONCHAIN[7]);
  for (const [time, accepted] of [["2026-10-06T23:59:59Z", true], ["2026-10-07T00:00:00Z", false]]) {
    if (accepted) { validateTrueMarketMeanDataset(tmm, { now: new Date(time) }); validateOnchainDataset(mvrv, 7, { now: new Date(time) }); }
    else { assert.throws(() => validateTrueMarketMeanDataset(tmm, { now: new Date(time) })); assert.throws(() => validateOnchainDataset(mvrv, 7, { now: new Date(time) })); }
  }
});

test("采集只访问确认的免费端点、不发送密钥，HTTP失败不尝试鉴权或代理", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push(url); assert.equal(options.headers?.authorization, undefined); assert.equal(options.headers?.["X-Api-Key"], undefined);
    return { ok: true, text: async () => url === FREE_ONCHAIN[7].endpoint ? JSON.stringify({ key: "mvrv_zscore", as_of: date, series: [[date, 1]] }) : plot([trace("Puell Multiple")]) };
  };
  for (const id of [7, 8]) assert.equal((await fetchOnchainDataset(id, { now, fetchImpl })).source.label, FREE_ONCHAIN[id].label);
  assert.deepEqual(calls, [FREE_ONCHAIN[7].endpoint, FREE_ONCHAIN[8].endpoint]);
  await assert.rejects(fetchFreeRows(FREE_TMM, { now, fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
});

test("公开TMM先读仓库新快照，失败回退站内；全失败保留原值", async () => {
  const dataset = buildPublishedTrueMarketMean([{ timestamp, value: 77380 }], { now });
  const data = { trueMarketMean: { value: 75000, asOf: "2026-09-20" } }, calls = [];
  await updateTrueMarketMeanFromSnapshot(data, async url => { calls.push(url); if (url.startsWith("https:")) throw Error("offline"); return { ok: true, json: async () => dataset }; }, now);
  assert.equal(data.trueMarketMean.source.label, FREE_TMM.label); assert.equal(calls.length, 2);
  const before = structuredClone(data);
  await assert.rejects(updateTrueMarketMeanFromSnapshot(data, async () => { throw Error("offline"); }, now));
  assert.deepEqual(data, before);
});
