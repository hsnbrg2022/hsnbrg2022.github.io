import test from "node:test";
import assert from "node:assert/strict";
import { parsePanewsEtf, loadPanewsEtf, mergeEtfCollection } from "../scripts/etf-media.mjs";
import { upsertManualEtfFlow } from "../scripts/manual-etf-flow.mjs";
import { summarizeEtfFlows } from "../etf-core.js";
import { updateEtf } from "../public-refresh.js";

const now = new Date("2026-09-21T12:00:00Z");
const article = (overrides = {}) => ({ id: "fixture-btc", type: "NEWS", status: "PUBLISHED", lang: "zh",
  title: "比特币现货 ETF 昨日净流入", publishedAt: "2026-09-19T04:00:00Z", updatedAt: "2026-09-19T04:01:00Z",
  content: "<p>据 SoSoValue 数据，昨日（美东时间 9 月 18 日）比特币现货 ETF 总净流入 4.33 亿美元。</p><p>IBIT净流入1亿美元，历史累计500亿美元。</p>", ...overrides });
const dataset = (reports, method = "public-media") => ({ schemaVersion: 1, asset: "BTC", unit: "USD_MILLIONS", status: "snapshot",
  marketDate: reports.at(-1).date, generatedAt: now.toISOString(), source: { method, label: "Fixture", url: "https://example.com" },
  rows: reports.map(({ date, flowUsdMillions }) => ({ date, flowUsdMillions })),
  recordOrigins: Object.fromEntries(reports.map(r => [r.date, r.origin])) });
const report = () => parsePanewsEtf(article(), now);

test("media parser selects aggregate, signed USD units and reported precision (including zero)", () => {
  assert.equal(report().flowUsdMillions, 433);
  assert.equal(report().origin.precisionUsdMillions, 1);
  const out = parsePanewsEtf(article({ content: article().content.replace("入 4.33 亿", "出 1328.93 万") }), now);
  assert.equal(out.flowUsdMillions, -13.2893);
  assert.equal(out.origin.precisionUsdMillions, 0.0001);
  assert.equal(parsePanewsEtf(article({ content: article().content.replace("4.33", "0") }), now).flowUsdMillions, 0);
});

test("media parser rejects weekly, individual, ambiguous, closed and future reports", () => {
  for (const overrides of [
    { title: "比特币现货ETF上周净流入" }, { content: article().content.replace("总净流入", "净资产") },
    { content: article().content.replace("美东时间 9 月 18 日", "美东时间 9月14日至9月18日") },
    { content: article().content.replace("9 月 18 日", "9 月 19 日") },
    { content: article().content.replace("9 月 18 日", "9 月 32 日") },
    { publishedAt: "2026-09-22T04:00:00Z" }, { updatedAt: "2026-09-22T04:00:00Z" },
    { content: article().content.replace("SoSoValue", "未知来源") }, { type: "NORMAL" }
  ]) assert.equal(parsePanewsEtf(article(overrides), now), null);
  const january = article({ publishedAt: "2027-01-01T04:00:00Z", updatedAt: "2027-01-01T04:01:00Z", content: article().content.replace("9 月 18 日", "12月31日") });
  assert.equal(parsePanewsEtf(january, new Date("2027-01-02T00:00:00Z")).date, "2026-12-31");
});

test("public search recovers a report outside the first page with bounded requests", async () => {
  const calls = [];
  const result = await loadPanewsEtf({ now, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body.skip);
    assert.equal(body.query, "SoSoValue"); assert.equal(body.take, 20); assert.ok(options.signal);
    return { ok: true, json: async () => body.skip === 0 ? Array.from({ length: 20 }, (_, i) => ({ article: { id: `other-${i}` } })) : [{ article: article() }] };
  } });
  assert.deepEqual(calls, [0, 20]); assert.equal(result.marketDate, "2026-09-18");
  assert.equal(result.rows[0].flowUsdMillions, 433); assert.equal(result.source.method, "public-media");
});

test("HTTP failure, empty results, repeated pages and conflicting reports fail closed", async () => {
  for (const response of [ { ok: false, status: 403 }, { ok: true, json: async () => [] },
    { ok: true, json: async () => Array.from({ length: 20 }, (_, i) => ({ article: { id: `repeat-${i}` } })) },
    { ok: true, json: async () => [{ article: article() }, { article: article({ id: "conflict", content: article().content.replace("4.33", "4.40") }) }] }
  ]) await assert.rejects(loadPanewsEtf({ now, fetchImpl: async () => response }));
});

test("collection preserves all legacy manual values and does not bridge missing days", () => {
  const current = { source: { method: "manual-entry" }, marketDate: "2026-09-16", rows: [{ date: "2026-09-16", flowUsdMillions: 12 }] };
  const incoming = dataset([{ ...report(), date: "2026-09-16", flowUsdMillions: -3 }, report()]);
  const merged = mergeEtfCollection(current, incoming);
  assert.deepEqual(merged.rows, [{ date: "2026-09-16", flowUsdMillions: 12 }, { date: "2026-09-18", flowUsdMillions: 433 }]);
  assert.equal(merged.recordOrigins["2026-09-16"].method, "manual-entry");
  assert.equal(summarizeEtfFlows(merged.rows).streak, 1);
  assert.equal(current.rows.length, 1);
});

test("only a later revision of the same media article can correct an automatic value", () => {
  const current = dataset([report()]);
  const revised = { ...report(), flowUsdMillions: 434, origin: { ...report().origin, revisedAt: "2026-09-20T04:00:00Z" } };
  const merged = mergeEtfCollection(current, dataset([revised]));
  assert.equal(merged.rows[0].flowUsdMillions, 434);
  assert.equal(merged.recordOrigins[revised.date].previousFlowUsdMillions, 433);
  assert.throws(() => mergeEtfCollection(current, dataset([{ ...revised, origin: { ...revised.origin, url: "https://example.com/other" } }])));
  assert.throws(() => mergeEtfCollection(current, dataset([{ ...revised, origin: report().origin }])));
});

test("unchanged results keep the exact snapshot and time; older collections are rejected", () => {
  const current = dataset([report()]);
  assert.equal(mergeEtfCollection(current, { ...current, generatedAt: "2026-09-22T00:00:00Z" }), current);
  assert.throws(() => mergeEtfCollection(current, dataset([{ ...report(), date: "2026-09-17" }])));
});

test("manual correction protects its date while retaining provenance of automatic dates", () => {
  const current = dataset([{ ...report(), date: "2026-09-17", flowUsdMillions: 159 }, report()]);
  const manual = upsertManualEtfFlow(current, { date: "2026-09-17", flowUsdMillions: 158, sourceKey: "farside" }, now).dataset;
  const merged = mergeEtfCollection(manual, current);
  assert.equal(merged.rows[0].flowUsdMillions, 158);
  assert.equal(merged.recordOrigins["2026-09-17"].method, "manual-entry");
  assert.equal(merged.recordOrigins["2026-09-18"].method, "public-media");
});

test("public refresh reads bot-updated repository data, falls back safely and never rolls back to older deployed data", async () => {
  const old = dataset([{ ...report(), date: "2026-09-17", flowUsdMillions: 159 }]);
  const fresh = dataset([report()]);
  for (const [remote, deployed, expected] of [[fresh, old, "2026-09-18"], [old, fresh, "2026-09-18"], [null, old, "2026-09-17"], [{}, fresh, "2026-09-18"]]) {
    const view = { cards: [{ id: 1 }] }; let saved;
    await updateEtf(view, async url => {
      const value = url.startsWith("https:") ? remote : deployed;
      if (!value) throw new Error("offline");
      return { ok: true, json: async () => value };
    }, value => { saved = value; });
    assert.equal(saved.marketDate, expected); assert.equal(view.cards[0].dataAsOf, expected);
  }
  const view = { cards: [{ id: 1, headline: "old" }] };
  await assert.rejects(updateEtf(view, async () => { throw new Error("offline"); }, () => {}));
  assert.equal(view.cards[0].headline, "old");
});
