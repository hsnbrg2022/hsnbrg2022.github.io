import test from "node:test";
import assert from "node:assert/strict";
import { assessMarket, cardQuality, weekdaysSince } from "../data-quality.js";
import { readFile } from "node:fs/promises";
import { refreshPublicDashboard } from "../public-refresh.js";
import { deriveDashboard, marketHeat } from "../model.js";
import { localizeDashboard, t } from "../i18n.js";
import { applyMacroQuote } from "../macro-quote.js";
import { normalizeStablecoinHistory } from "../stablecoin-source.js";
const now = new Date("2026-09-05T08:00:00Z");

test("ETF/mNAV 两工作日边界和周末；不使用刷新检查时间翻新观测", () => {
  for (const id of [1, 2]) {
    const basis = { basisAsOf: "2026-08-31", mnavMode: "official-live" };
    assert.equal(cardQuality({ id, ...basis, dataAsOf: "2026-09-02" }, now).eligible, true);
    assert.equal(cardQuality({ id, ...basis, dataAsOf: "2026-09-01", lastRefreshAt: now.toISOString() }, now).state, "stale");
  }
  assert.equal(weekdaysSince("2026-09-04", new Date("2026-09-06T08:00:00Z")), 0);
  assert.equal(weekdaysSince("2026-09-04", new Date("2026-09-09T08:00:00Z")), 3);
});

test("三天、24小时、45天采用确认的时效边界", () => {
  for (const [id, days] of [[3, 3], [5, 3], [6, 3], [9, 1], [4, 45]]) {
    const checkNow = id === 3 ? new Date("2026-09-05T00:00:00Z") : now;
    const asOf = new Date(+checkNow - days * 86400000).toISOString();
    const input = { id, dataAsOf: asOf };
    if (id === 3) input.stablecoin = normalizeStablecoinHistory([0, 7].map(day => ({ date: (Date.parse(asOf) - day * 86400000) / 1000, totalCirculatingUSD: { peggedUSD: 300e9 } })), checkNow);
    assert.equal(cardQuality(input, checkNow).eligible, true);
    assert.equal(cardQuality(input, new Date(+checkNow + 1)).eligible, false);
  }
  assert.equal(cardQuality({ id: 5, marketFetchedAt: "2026-09-04 ECB 日终" }, now).eligible, true);
  assert.equal(cardQuality({ id: 5, marketFetchedAt: "Fri, 04 Sep 2026 00:00:00 GMT" }, now).eligible, true);
});

test("宏观接口未给观测时间时，不把请求时间当成行情时间", () => {
  const card = { id: 6, shortName: "黄金" };
  applyMacroQuote(card, { price: 4800, change: null, source: "test" }, { id: 6, now });
  assert.equal(card.marketQuote.asOf, null);
  assert.equal(cardQuality(card, now).eligible, false);
});

test("日期缺失、非法、未来及缺少来源日期的链上读数待核验", () => {
  for (const asOf of [undefined, "bad", "2026-13-01", "2026-02-30", "2026-09-06"]) {
    assert.equal(cardQuality({ id: 6, dataAsOf: asOf }, now).state, "unknown");
  }
  for (const id of [7, 8]) assert.equal(cardQuality({ id }, now).eligible, false);
});

test("mNAV 资本基准和转换分类独立于行情日期控制确认", () => {
  const card = { id: 2, dataAsOf: "2026-09-04", status: "green", basisAsOf: "2026-08-31" };
  assert.equal(cardQuality(card, now).reason, "mnavClassificationUnknown");
  assert.equal(cardQuality({ ...card, mnavMode: "official-live" }, now).eligible, true);
  assert.equal(cardQuality({ ...card, basisAsOf: "2026-08-28", mnavMode: "official-live" }, now).reason, "mnavBasisStale");
  for (const reason of ["mnavBasisUnknown", "mnavBasisStale", "mnavClassificationUnknown"]) {
    assert.doesNotMatch(t("en", reason), /[\u4e00-\u9fff]/);
    assert.notEqual(t("en", reason), reason);
  }
});

const marketNow = new Date("2026-09-08T04:00:00Z");
const market = { btcPrice: 75000, btcCurrency: "USD", btcChange24h: 7.8, btcChange: { value: 7.8, basis: "rolling24h", source: "test" }, btcSource: "test", fng: 80, btcObservedAt: marketNow.toISOString(), btcFetchedAt: marketNow.toISOString(), fngFetchedAt: marketNow.toISOString() };

test("BTC 15 分钟、F&G 36 小时含边界；一次刷新失败不等同于过期", () => {
  for (const [key, limit] of [["btc", 15 * 60_000], ["fng", 36 * 3_600_000]]) {
    const input = { ...market, [key === "btc" ? "btcObservedAt" : "fngFetchedAt"]: new Date(+marketNow - limit).toISOString(), refreshStatus: "failed" };
    assert.equal(assessMarket(input, marketNow)[key].eligible, true);
    assert.equal(assessMarket(input, new Date(+marketNow + 1))[key].state, "stale");
  }
});

test("缺失、非法、未来日期和无效数值不参与当前解释；不受全局时间影响", () => {
  for (const asOf of [undefined, "bad", "2026-02-30T00:00:00Z", "2030-01-01T00:00:00Z"]) {
    const quality = assessMarket({ ...market, btcObservedAt: asOf, fngFetchedAt: asOf, updatedAt: marketNow.toISOString() }, marketNow);
    assert.equal(quality.btc.state, "unknown");
    assert.equal(quality.fng.state, "unknown");
  }
  for (const btcPrice of [null, NaN, -1, "75000"]) assert.equal(assessMarket({ ...market, btcPrice }, marketNow).btc.eligible, false);
  for (const fng of [null, NaN, -1, 101]) assert.equal(assessMarket({ ...market, fng }, marketNow).fng.eligible, false);
});

test("中英文当前结论只使用时效内 BTC/F&G，旧数值原样保留且九卡评分不变", async () => {
  const base = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url)));
  const input = { ...base, market: { ...base.market, ...market } };
  const fresh = deriveDashboard(input, marketNow);
  assert.match(fresh.risks.join(" "), /7.80%/);
  assert.match(fresh.summary, /极度贪婪/);
  const old = { ...input, market: { ...input.market, btcObservedAt: "2026-08-01T00:00:00Z", fngFetchedAt: "2026-08-01T00:00:00Z" } };
  const stale = deriveDashboard(old, marketNow);
  assert.equal(stale.market.btcPrice, 75000);
  assert.equal(stale.market.fng, 80);
  assert.equal(stale.score, fresh.score);
  assert.doesNotMatch(stale.risks.join(" "), /F&G|BTC 24h/);
  assert.match(stale.summary, /暂不作当前情绪判断/);
  assert.doesNotMatch(stale.previous.changes.join(" "), /BTC \$/);
  const en = localizeDashboard(stale, "en");
  assert.match(en.summary, /no current sentiment conclusion/);
  assert.doesNotMatch(en.previous.changes.slice(0, 2).join(" ") + en.heat.label, /[\u4e00-\u9fff]/);
  assert.equal(localizeDashboard(fresh, "en").heat.label, "Extreme greed");
  assert.match(t("en", "marketTime", { time: "test" }), /15 minutes.*36 hours/);
  assert.equal(input.marketQuality, undefined);
});

test("所有公开源失败后，全局刷新时间推进也不会翻新顶部旧值", async () => {
  const base = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url)));
  const input = { ...base, market: { ...base.market, ...market, btcObservedAt: "2026-08-01T00:00:00Z", fngFetchedAt: "2026-08-01T00:00:00Z" } };
  const result = await refreshPublicDashboard(input, { fetchImpl: async () => { throw new Error("offline fixture"); } });
  assert.equal(result.updated.length, 0);
  assert.equal(result.data.updatedAt, result.checkedAt);
  const derived = deriveDashboard(result.data, marketNow);
  assert.equal(derived.marketQuality.btc.state, "stale");
  assert.equal(derived.marketQuality.fng.state, "stale");
  assert.doesNotMatch(derived.risks.join(" "), /F&G|BTC 24h/);
});

test("最新官方 mNAV 可展示但未核验资本不加分，双语解读不是旧值", async () => {
  const raw = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url), "utf8"));
  raw.cards = [{ id: 2, title: "Strategy mNAV", headline: "1.22x", status: "green", facts: [], source: { label: "Strategy", url: "https://www.strategy.com/btc" }, dataAsOf: "2026-09-04", basisAsOf: "2026-08-31", mnavMode: "official-live", mnavBasisComplete: false }];
  const view = deriveDashboard(raw, now);
  assert.equal(view.score, 0);
  assert.equal(view.coverage, 0);
  assert.equal(view.cards[0].headline, "1.22x");
  assert.match(view.cards[0].detail, /独立更新/);
  assert.doesNotMatch(localizeDashboard(view, "en").cards[0].detail, /[\u4e00-\u9fff]|previous reading/i);
});

test("仅请求失败不改变有效覆盖，过期后退出确认但原灯色和数值保留", async () => {
  const data = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url)));
  for (const card of data.cards) { card.dataAsOf = now.toISOString(); card.status = "green"; }
  Object.assign(data.cards.find(card => card.id === 2), { basisAsOf: "2026-08-31", mnavMode: "official-live", mnavBasisComplete: true });
  // Controlled fixture: two legacy on-chain readings have no validated observations.
  for (const card of data.cards.filter(card => [7, 8].includes(card.id))) delete card.onchain;
  data.cards.find(card => card.id === 3).stablecoin = normalizeStablecoinHistory(["2026-08-28", "2026-09-04"].map(date => ({ date: Date.parse(date) / 1000, totalCirculatingUSD: { peggedUSD: 300e9 } })), now);
  const fresh = deriveDashboard(data, now);
  for (const card of data.cards) card.refreshStatus = "failed";
  const failed = deriveDashboard(data, now);
  assert.equal(fresh.score, 7);
  assert.equal(failed.score, fresh.score);
  const stale = deriveDashboard(data, new Date("2026-12-01T08:00:00Z"));
  assert.equal(stale.score, 0);
  assert.equal(stale.pending, 9);
  assert.equal(stale.cards[0].status, "green");
  assert.equal(stale.cards[0].headline, data.cards[0].headline);
  assert.equal(data.cards[0].quality, undefined);
  assert.match(stale.summary, /不作全局方向确认/);
  const english = localizeDashboard(stale, "en");
  assert.equal(english.score, stale.score);
  assert.match(english.summary, /valid coverage 0\/9/);
  assert.doesNotMatch(english.summary, /[\u4e00-\u9fff]/);
  assert.match(t("en", "qualityStale"), /Historical/);
});

test("F&G 区间判定包含边界", () => {
  assert.equal(marketHeat(75).label, "极度贪婪");
  assert.equal(marketHeat(55).label, "贪婪");
  assert.equal(marketHeat(45).label, "中性");
  assert.equal(marketHeat(25).label, "恐惧");
  assert.equal(marketHeat(24).label, "极度恐惧");
});
