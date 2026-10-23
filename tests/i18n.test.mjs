import test from "node:test";
import assert from "node:assert/strict";
import { getInitialLanguage, t } from "../i18n.js";

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
