import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deriveDashboard } from "../model.js";
import { getInitialLanguage, indicatorHelp, indicatorHelpKeyForCard, indicatorHelpKeyForFact, localizeDashboard, t, translateMode, translateText } from "../i18n.js";

const fixture = JSON.parse(await readFile(new URL("../dashboard.json", import.meta.url), "utf8"));

test("新访客默认使用中文并可记住英文选择", () => {
  assert.equal(getInitialLanguage({ getItem: () => null }), "zh");
  assert.equal(getInitialLanguage({ getItem: () => "en" }), "en");
  assert.equal(getInitialLanguage({ getItem: () => { throw new Error("storage unavailable"); } }), "zh");
  assert.equal(t("zh", "etfFailedAsOf", { date: "2026/08/24" }), "刷新失败 · 保留 2026/08/24 数据");
  assert.equal(t("en", "etfFailedAsOf", { date: "2026/08/24" }), "Refresh failed · Keeping 2026/08/24 data");
  assert.equal(t("zh", "etfMaintenanceTitle"), "维护 BTC ETF 资金流");
  assert.equal(t("en", "etfMaintenanceTitle"), "Maintain BTC ETF flows");
  assert.match(t("zh", "etfPublishHint"), /etf-flows\.json/);
  assert.match(t("en", "etfPublishHint"), /dashboard\.json/);
  assert.match(t("zh", "etfBrowserPolicy"), /不会写回 GitHub/);
  assert.match(t("en", "etfBrowserPolicy"), /not written back to GitHub/);
  assert.match(t("zh", "etfLocalPolicy"), /GitHub 根目录/);
  assert.match(t("zh", "etfEditingRecord", { date: "2026\/08\/27" }), /覆盖原值/);
  assert.match(t("en", "etfEditingRecord", { date: "2026\/08\/27" }), /replace its previous value/);
  assert.equal(t("en", "saveAndSync"), "Save and sync");
  assert.equal(t("zh", "trueMarketMeanAuto"), "每日自动更新");
  assert.equal(t("en", "trueMarketMeanFailed"), "Auto-update failed · Keeping last value");
});

test("英文模式翻译界面数据但不改变行情数值", () => {
  const source = deriveDashboard(structuredClone(fixture));
  const localized = localizeDashboard(source, "en");
  assert.equal(localized.market.btcPrice, source.market.btcPrice);
  assert.equal(localized.cards.find((item) => item.id === 3).title, "Stablecoin Market Cap");
  assert.equal(localized.cards.find((item) => item.id === 9).shortName, "L/S Ratio");
  assert.match(localized.summary, /dashboard/i);
  assert.doesNotMatch(localized.risks.join(" "), /[\u4e00-\u9fff]/);
  assert.doesNotMatch(localized.macroNotes.join(" "), /[\u4e00-\u9fff]/);
  assert.equal(translateMode("本地维护 + 实时数据", "en"), "Local override + live data");
});

test("中英文基线对比引用相同最新价格，英文不保留旧变化文本", () => {
  const data = structuredClone(fixture);
  data.market.btcPrice = 80000;
  data.market.btcCurrency = "USD";
  data.market.btcFetchedAt = new Date().toISOString();
  data.market.btcObservedAt = data.market.btcFetchedAt;
  data.cards.find((card) => card.id === 6).headline = "$4,800.00 · 涨跌基准暂不可用";
  const derived = deriveDashboard(data);
  const en = localizeDashboard(derived, "en");
  assert.match(en.previous.changes.join(" "), /\$80,000/);
  assert.match(en.previous.changes.join(" "), /\$4,800\.00/);
  assert.doesNotMatch(en.previous.changes.join(" "), /[\u4e00-\u9fff]/);
});

test("指标说明与网页指标严格对应且提供中英文内容", () => {
  assert.equal(indicatorHelpKeyForCard(1), "btcEtfFlows");
  assert.equal(indicatorHelpKeyForCard(4), "fedOfficialStance");
  assert.equal(indicatorHelpKeyForCard(7), "mvrv");
  assert.equal(indicatorHelpKeyForCard(8), "puell");
  assert.equal(indicatorHelpKeyForCard(2), "strategyMnav");

  const zhMvrv = indicatorHelp("zh", indicatorHelpKeyForCard(7));
  const enMvrv = indicatorHelp("en", indicatorHelpKeyForCard(7));
  assert.equal(zhMvrv.title, "MVRV Z-Score");
  assert.equal(enMvrv.title, "MVRV Z-Score");
  assert.equal(indicatorHelpKeyForFact(7, "价 / BP 1.94x"), "balancedPrice");
  assert.equal(indicatorHelpKeyForFact(7, "Price / BP 1.94x"), "balancedPrice");
  assert.equal(indicatorHelp("zh", "balancedPrice").title, "Balanced Price（均衡价格）");
  assert.equal(indicatorHelp("en", "balancedPrice").title, "Balanced Price");

  const zhPuell = indicatorHelp("zh", indicatorHelpKeyForCard(8));
  const enPuell = indicatorHelp("en", indicatorHelpKeyForCard(8));
  assert.equal(zhPuell.title, "Puell Multiple");
  assert.equal(indicatorHelp("zh", "sopr").title, "SOPR（卖出盈亏比）");
  assert.equal(indicatorHelp("en", "sopr").title, "SOPR (Spent Output Profit Ratio)");
  assert.equal(indicatorHelpKeyForFact(8, "ahr999 0.48"), "ahr999");
  assert.equal(indicatorHelp("zh", "ahr999").title, "ahr999 定投指数");
  assert.equal(indicatorHelp("en", "ahr999").title, "ahr999 DCA Index");

  assert.equal(indicatorHelp("zh", "fearGreed").title, "恐惧贪婪指数");
  assert.equal(indicatorHelp("en", "fearGreed").title, "Fear & Greed Index");
  assert.match(indicatorHelp("zh", "wma200").points.join(" "), /BTC 价格 ÷ 200 WMA/);
  assert.match(indicatorHelp("en", "wma200").points.join(" "), /BTC price ÷ 200 WMA/);
  assert.equal(indicatorHelp("zh", "trueMarketMean").title, "True Market Mean（真实市场均值）");
  assert.equal(indicatorHelp("en", "trueMarketMean").title, "True Market Mean");
  assert.match(indicatorHelp("zh", "trueMarketMean").points.join(" "), /Investor Cap（投资者资本）÷ Active Supply/);
  assert.equal(indicatorHelp("zh", "btcEtfFlows").title, "BTC ETF 资金流");
  assert.equal(indicatorHelp("en", "btcEtfFlows").title, "BTC ETF Flows");
  assert.match(indicatorHelp("zh", "btcEtfFlows").points.join(" "), /周末停留在周五属于正常情况/);
  assert.equal(indicatorHelp("zh", "fedOfficialStance").title, "Fed 官方立场");
  assert.equal(indicatorHelp("en", "fedOfficialStance").title, "Official Fed Stance");
  assert.match(indicatorHelp("zh", "fedOfficialStance").points.join(" "), /主席讲话属于辅助信息/);
  assert.match(indicatorHelp("zh", "strategyMnav").points.join(" "), /MSTR 股价 ÷ Net Bitcoin Per Share/);
  assert.match(indicatorHelp("en", "strategyMnav").summary, /July 23, 2026/);
  assert.equal(translateText("ETF 发布快照 / Farside", "en"), "ETF published snapshot / Farside");
  assert.equal(translateText("维持利率 · 主席基调偏鹰", "en"), "Held rates · Chair tone hawkish");
  assert.equal(translateText("下次会议 9/15–9/16", "en"), "Next meeting 9/15–9/16");
});
