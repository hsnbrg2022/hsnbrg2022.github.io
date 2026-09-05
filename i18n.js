import { buildCurrentChanges } from "./model.js?v=20260905-1";

export const LANGUAGE_STORAGE_KEY = "crypto-signal-tracker:language-v1";

const MESSAGES = {
  zh: {
    brand: "加密看板追踪器", backTop: "回到顶部", switchLanguage: "Switch to English", languageButton: "EN",
    heroTitle: "先看信号，<br><em>再做决定。</em>", heroCopy: "将资金、宏观、链上估值与仓位结构压缩成一张每日决策面板。",
    refresh: "刷新最新数据", refreshTitle: "更新 ETF、mNAV、BTC、F&G、稳定币、Fed、True Market Mean、DXY、黄金与 200WMA", copy: "复制全文",
    todayStatus: "今日状态", calculating: "正在计算信号…", briefing: "今日研判", summary: "摘要", changes: "基线对比与当前信号", risks: "风险提示", watch: "宏观观察",
    footer: "公开访客可刷新实时公开数据；手工维护仅保存在当前浏览器。仅供研究与信息整理，不构成投资建议。", footerLocal: "本地维护会同步生成公开版数据文件。仅供研究与信息整理，不构成投资建议。",
    lastUpdated: "最后更新 {time}（UTC+8）", syncing: "正在同步最新数据…", cached: "最近缓存",
    aboveWma: "价格位于长期成本线上方", belowWma: "价格位于长期成本线下方",
    bullishNoRed: "偏多主导 · 无红灯", redSignals: "出现 {count} 项风险信号", mixedSignals: "信号分化 · 保持观察",
    maintain: "手动维护", manual: "手动口径", publishedRefresh: "发布时已刷新", visitorRefresh: "访客刚刚刷新", refreshFailed: "刷新失败 · 保留最近值", mnavAuto: "交易日自动更新",
    positioningTitle: "手动维护多空比", positioningNote: "只需填写账户比与仓位比；仓帐比、信号等级和解读将自动计算。数据仅保存在当前浏览器，不会影响其他访客。",
    positioningLocalNote: "只需填写账户比与仓位比；仓帐比、信号等级和解读将自动计算。保存会同步更新 GitHub Pages 发布快照。",
    accountRatio: "账户比", positionRatio: "仓位比", bookAccountRatio: "仓帐比（自动计算）", ratioHelp: "仓位比 ÷ 账户比，仅展示、不可编辑",
    reset: "恢复发布值", cancel: "取消", saveBrowser: "保存到本浏览器", saveAndSync: "保存并同步", close: "关闭",
    savedPositioning: "多空比已保存到当前浏览器", savedPositioningLocal: "多空比已保存，公开版快照已同步", resetPositioning: "已恢复发布时的多空比", invalidRatio: "账户比必须大于 0，且仓位比必须为有效数字", saveFailed: "保存失败",
    loadingDashboard: "看板数据仍在加载，请稍后重试", languageChanged: "已切换为中文",
    indicatorHelpLabel: "查看{indicator}说明", indicatorGuide: "指标说明", confluenceTitle: "组合信号",
    trueMarketMeanEyebrow: "活跃投资者成本基础", trueMarketMeanSupport: "BTC 高于成本线 {distance}% · 下方成本支撑", trueMarketMeanResistance: "BTC 低于成本线 {distance}% · 上方成本阻力", trueMarketMeanTesting: "BTC 距成本线 {distance}% · 正在测试",
    trueMarketMeanAsOf: "数据截至 {date}", trueMarketMeanManual: "手工维护", trueMarketMeanAuto: "每日自动更新", trueMarketMeanFailed: "自动更新失败 · 保留最近值", freshnessFresh: "数据正常", freshnessAging: "数据可能滞后", freshnessStale: "数据已过期",
    etfLiveAsOf: "交易日数据 · 截至 {date}", etfSnapshotAsOf: "发布快照 · 截至 {date}", etfStaleAsOf: "ETF 数据可能滞后 · 截至 {date}", etfFailedAsOf: "刷新失败 · 保留 {date} 数据",
    etfMaintenanceTitle: "维护 BTC ETF 资金流", etfMaintenanceNote: "只需填写交易日期和当日总净流量，系统将自动计算连续天数、累计金额和信号状态。", etfTradeDate: "交易日期", etfNetFlow: "当日总净流量（百万美元）", etfNetFlowHelp: "正数表示净流入，负数表示净流出", etfManualSource: "人工核对来源", etfRecentHistory: "最近记录", etfRecentHistoryHint: "点击任一记录可载入并修改", etfEditAction: "修改", etfEditingRecord: "正在修改 {date} 的记录；保存后将覆盖原值。", etfUpdateAndSync: "保存修改并同步", etfUpdateBrowser: "保存修改到本浏览器", etfPublishHint: "保存后将同步公开版快照；上传 etf-flows.json 和 dashboard.json 即可发布给访客。", etfSave: "保存并同步", etfSaved: "ETF 数据已保存，公开版快照已同步", etfUpdated: "ETF 最近记录已修改，公开版快照已同步", etfLoading: "正在读取 ETF 历史…",
    etfLocalNote: "填写交易日期和当日总净流量；点击最近记录可回填并修改，保存会更新本地看板和 GitHub Pages 发布数据。", etfBrowserNote: "填写交易日期和当日总净流量；点击最近记录可回填并修改。公开版修改只保存在当前浏览器。", etfLocalPolicy: "全局发布方式：本地保存后，上传 dashboard.json 与 etf-flows.json 到 GitHub 根目录。", etfBrowserPolicy: "浏览器本地数据：不会写回 GitHub，不会同步到其他设备或访客。", etfSavedBrowser: "ETF 数据已保存到当前浏览器，不影响其他访客", etfUpdatedBrowser: "ETF 最近记录已修改并保存到当前浏览器", etfResetBrowser: "已恢复 GitHub 发布的 ETF 数据", etfLoadFailed: "无法读取 ETF 历史", browserOnlyShort: "当前浏览器手工数据",
    capital: "资金面", capitalSub: "资本是否在入场", macro: "宏观", macroSub: "流动性环境是否友好", onchain: "链上估值", onchainSub: "周期位置", positioning: "仓位情绪", positioningSub: "衍生品结构",
    statusGreen: "触发", statusYellow: "观察", statusRed: "风险", statusOff: "未触发"
  },
  en: {
    brand: "Crypto Signal Tracker", backTop: "Back to top", switchLanguage: "切换到中文", languageButton: "中文",
    heroTitle: "Read the signals.<br><em>Then decide.</em>", heroCopy: "A daily decision dashboard spanning capital flows, macro liquidity, on-chain valuation and positioning.",
    refresh: "Refresh latest data", refreshTitle: "Update ETF flows, mNAV, BTC, F&G, stablecoins, Fed, True Market Mean, DXY, gold and 200WMA", copy: "Copy report",
    todayStatus: "Today's status", calculating: "Calculating signals…", briefing: "Daily view", summary: "Summary", changes: "Baseline comparison & current signals", risks: "Risk alerts", watch: "Macro watch",
    footer: "Visitors can refresh public data. Manual changes are stored only in this browser. For research only; not financial advice.", footerLocal: "Local maintenance generates the public data files for publishing. For research only; not financial advice.",
    lastUpdated: "Last updated {time} (UTC+8)", syncing: "Syncing latest data…", cached: "cached",
    aboveWma: "Price is above the long-term cost basis", belowWma: "Price is below the long-term cost basis",
    bullishNoRed: "Bullish bias · No red flags", redSignals: "{count} risk signal(s)", mixedSignals: "Mixed signals · Stay selective",
    maintain: "Maintain", manual: "Manual", publishedRefresh: "Refreshed at publish", visitorRefresh: "Just refreshed", refreshFailed: "Refresh failed · Using last value", mnavAuto: "Updated automatically each trading day",
    positioningTitle: "Maintain long/short ratios", positioningNote: "Enter the account ratio and position ratio. The position/account ratio, signal tier and interpretation are calculated automatically. Values are stored only in this browser.",
    positioningLocalNote: "Enter the account and position ratios. The derived ratio and signal are calculated automatically, then synced to the GitHub Pages snapshot.",
    accountRatio: "Account ratio", positionRatio: "Position ratio", bookAccountRatio: "Position / account (calculated)", ratioHelp: "Position ratio ÷ account ratio. Display only; not editable.",
    reset: "Restore published", cancel: "Cancel", saveBrowser: "Save in this browser", saveAndSync: "Save and sync", close: "Close",
    savedPositioning: "Long/short ratios saved in this browser", savedPositioningLocal: "Long/short ratios saved and the public snapshot is synced", resetPositioning: "Published long/short ratios restored", invalidRatio: "Account ratio must be above 0 and position ratio must be valid", saveFailed: "Save failed",
    loadingDashboard: "Dashboard is still loading. Please try again shortly.", languageChanged: "Switched to English",
    indicatorHelpLabel: "About {indicator}", indicatorGuide: "Indicator guide", confluenceTitle: "Confluence signal",
    trueMarketMeanEyebrow: "Active-investor cost basis", trueMarketMeanSupport: "BTC is {distance}% above · Cost-basis support below", trueMarketMeanResistance: "BTC is {distance}% below · Cost-basis resistance above", trueMarketMeanTesting: "BTC is {distance}% from the cost basis · Testing the level",
    trueMarketMeanAsOf: "Data as of {date}", trueMarketMeanManual: "Manually maintained", trueMarketMeanAuto: "Updated automatically each day", trueMarketMeanFailed: "Auto-update failed · Keeping last value", freshnessFresh: "Current", freshnessAging: "May be stale", freshnessStale: "Stale data",
    etfLiveAsOf: "Trading-day data · As of {date}", etfSnapshotAsOf: "Published snapshot · As of {date}", etfStaleAsOf: "ETF data may be stale · As of {date}", etfFailedAsOf: "Refresh failed · Keeping {date} data",
    etfMaintenanceTitle: "Maintain BTC ETF flows", etfMaintenanceNote: "Enter the trading date and daily total net flow. Streaks, cumulative flow and signal status are calculated automatically.", etfTradeDate: "Trading date", etfNetFlow: "Daily total net flow (USD millions)", etfNetFlowHelp: "Positive means net inflow; negative means net outflow", etfManualSource: "Manual verification source", etfRecentHistory: "Recent records", etfRecentHistoryHint: "Select any record to load and edit it", etfEditAction: "Edit", etfEditingRecord: "Editing the {date} record. Saving will replace its previous value.", etfUpdateAndSync: "Save changes and sync", etfUpdateBrowser: "Save changes in this browser", etfPublishHint: "Saving syncs the public snapshot. Upload etf-flows.json and dashboard.json to publish it for visitors.", etfSave: "Save and sync", etfSaved: "ETF flow saved and the public snapshot is synced", etfUpdated: "Recent ETF record updated and the public snapshot is synced", etfLoading: "Loading ETF history…",
    etfLocalNote: "Enter the trading date and daily total net flow. Select a recent record to load and edit it; saving updates the local dashboard and GitHub Pages data.", etfBrowserNote: "Enter the trading date and daily total net flow. Select a recent record to edit it. Public-site changes stay only in this browser.", etfLocalPolicy: "Global publishing: after saving locally, upload dashboard.json and etf-flows.json to the GitHub repository root.", etfBrowserPolicy: "Browser-local data: it is not written back to GitHub and does not sync to other devices or visitors.", etfSavedBrowser: "ETF flows saved in this browser only; other visitors are unaffected", etfUpdatedBrowser: "Recent ETF record updated in this browser", etfResetBrowser: "Published ETF data restored", etfLoadFailed: "Unable to load ETF history", browserOnlyShort: "Browser-local manual data",
    capital: "Capital flows", capitalSub: "Is capital entering?", macro: "Macro", macroSub: "Is liquidity supportive?", onchain: "On-chain valuation", onchainSub: "Where are we in the cycle?", positioning: "Positioning", positioningSub: "Derivatives structure",
    statusGreen: "Active", statusYellow: "Watch", statusRed: "Risk", statusOff: "Inactive"
  }
};

const INDICATOR_HELP = {
  zh: {
    btcEtfFlows: {
      title: "BTC ETF 资金流",
      summary: "汇总美国现货比特币 ETF 每个交易日的净申购与净赎回，用于观察机构配置资金方向。",
      points: ["正值代表当日净流入，负值代表当日净流出；单位为百万美元。", "数据只在美股交易日产生，通常在美国晚间陆续更新；周末停留在周五属于正常情况。", "连续净流入反映配置需求增强，但它不是 BTC 当日价格涨跌的直接保证。"]
    },
    strategyMnav: {
      title: "Strategy mNAV（最新口径）",
      summary: "衡量 MSTR 股价相对每股净比特币美元价值的溢价或折价。Strategy 自 2026-07-23 起采用此口径。",
      points: ["计算方式：MSTR 股价 ÷ Net Bitcoin Per Share ($)。", "Net BPS 会扣除债务与优先股等高级索偿，并计入 USD Assets，再除以完全摊薄股数。", "1.0x 以上表示股价高于 Net BPS，1.0x 以下表示折价；本卡的市场价格自动更新，资本结构采用最新官方披露基准。"]
    },
    fedOfficialStance: {
      title: "Fed 官方立场",
      summary: "跟踪 FOMC 集体利率决策，并用美联储主席最新货币政策讲话补充语气判断。",
      points: ["状态灯只由 FOMC 实际行动决定：降息为绿色、维持为黄色、加息为红色。", "主席讲话属于辅助信息，只显示偏鹰、偏鸽或中性，不能覆盖 FOMC 集体决策。", "数据来自 Federal Reserve 官方 RSS、公告原文和 FOMC 会议日历；不代表市场降息概率。"]
    },
    fearGreed: {
      title: "恐惧贪婪指数",
      summary: "范围为 0–100，数值越低代表市场越恐慌。",
      points: ["<25：极度恐惧，通常对应抛售与潜在低位机会。", ">75：极度贪婪，市场偏热，应避免盲目追高。"]
    },
    wma200: {
      title: "200 周均线（200 WMA）",
      summary: "比特币的长期成本锚。历史上持续跌破该均线的情况很少。",
      points: ["价格接近 200 WMA 时，通常进入深度价值观察区。", "页面显示的倍数 = BTC 价格 ÷ 200 WMA；越接近 1.0x，价格越靠近均线。"]
    },
    mvrv: {
      title: "MVRV Z-Score",
      summary: "对 MVRV 做统计标准化，以减弱极端波动干扰，用于判断周期估值位置。",
      points: ["Z-Score <0：历史级低估区；>7：历史泡沫高位区。", "MVRV = 市值 ÷ 已实现市值。<1 通常表示多数持币者处于亏损；>3.5 表示整体盈利丰厚、估值偏热。"],
      confluence: "MVRV <1、Puell <0.5、恐惧指数处于极度恐惧且价格接近 200 WMA 时，四项共振才构成历史级抄底窗口。"
    },
    balancedPrice: {
      title: "Balanced Price（均衡价格）",
      summary: "已实现价格减去链上转移价格得到的公允价值参考。",
      points: ["历史周期底部经常落在该价格附近。", "页面中的“价 / BP”表示 BTC 价格相对 Balanced Price 的倍数。"]
    },
    puell: {
      title: "Puell Multiple",
      summary: "矿工每日新增 BTC 的美元价值 ÷ 过去 365 天平均值，用于衡量矿工收入压力。",
      points: ["<0.5：矿工收入严重承压，历史上常见于大周期底部。", ">4：矿工收入异常高，顶部风险升温。"],
      confluence: "MVRV <1、Puell <0.5、恐惧指数处于极度恐惧且价格接近 200 WMA 时，四项共振才构成历史级抄底窗口。"
    },
    sopr: {
      title: "SOPR（卖出盈亏比）",
      summary: "衡量链上每一笔卖出相对买入成本的整体盈亏。",
      points: ["<1：市场整体在亏损卖出，常见于投降阶段；>1：市场整体在获利卖出。", "长期低于 1 后重新回升，常被视为底部修复信号。"]
    },
    ahr999: {
      title: "ahr999 定投指数",
      summary: "综合 BTC 当前价格与 200 日定投成本，用于判断定投性价比。",
      points: ["<0.45：抄底区；0.45–1.2：适合定投区。", ">1.2：价格偏贵，应谨慎追高。"]
    },
    trueMarketMean: {
      title: "True Market Mean（真实市场均值）",
      summary: "面向活跃投资者的链上平均成本基础，也称 Active-Investor Price。",
      points: ["计算方式：Investor Cap（投资者资本）÷ Active Supply（活跃供应量）。", "BTC 位于其上方时，该水平通常作为潜在成本支撑；位于其下方时，通常作为潜在成本阻力。", "这是链上估值参考，不是保证价格反转的单一交易信号。"]
    }
  },
  en: {
    btcEtfFlows: {
      title: "BTC ETF Flows",
      summary: "Aggregates daily net subscriptions and redemptions across U.S. spot Bitcoin ETFs to track institutional allocation demand.",
      points: ["Positive values are net inflows and negative values are net outflows; figures are in USD millions.", "Data is produced only on U.S. trading days and is typically finalized during the U.S. evening; a Friday date over the weekend is normal.", "A sustained inflow streak signals stronger allocation demand, but does not guarantee BTC’s daily price direction."]
    },
    strategyMnav: {
      title: "Strategy mNAV (current methodology)",
      summary: "Measures the premium or discount of MSTR's share price to its net Bitcoin value per share. Strategy has used this definition since July 23, 2026.",
      points: ["Formula: MSTR share price ÷ Net Bitcoin Per Share ($).", "Net BPS deducts senior debt and preferred claims, adds USD Assets, then divides by fully diluted shares.", "Above 1.0x means the shares trade above Net BPS; below 1.0x means a discount. Market prices update automatically while the capital structure follows the latest official disclosure basis."]
    },
    fedOfficialStance: {
      title: "Official Fed Stance",
      summary: "Tracks collective FOMC rate decisions, with the Fed Chair’s latest monetary-policy remarks as a secondary tone signal.",
      points: ["Only actual FOMC action sets the status: a cut is green, a hold is yellow, and a hike is red.", "Chair remarks are secondary and can be labeled hawkish, dovish or neutral, but never override the collective decision.", "Data comes from official Federal Reserve RSS feeds, source pages and the FOMC calendar; it is not a market-implied rate probability."]
    },
    fearGreed: {
      title: "Fear & Greed Index",
      summary: "Ranges from 0 to 100. Lower readings indicate greater market fear.",
      points: ["<25: Extreme Fear, often associated with capitulation and potential value opportunities.", ">75: Extreme Greed; the market is running hot, so avoid chasing price blindly."]
    },
    wma200: {
      title: "200-Week Moving Average (200 WMA)",
      summary: "Bitcoin’s long-term cost anchor. Sustained trades below it have historically been rare.",
      points: ["When price approaches the 200 WMA, it often enters a deep-value watch zone.", "The displayed multiple equals BTC price ÷ 200 WMA; the closer it is to 1.0x, the closer price is to the average."]
    },
    mvrv: {
      title: "MVRV Z-Score",
      summary: "A statistically standardized version of MVRV that reduces the effect of extreme volatility and helps locate cycle valuation.",
      points: ["Z-Score <0: historically undervalued; >7: historical bubble territory.", "MVRV = market cap ÷ realized cap. Below 1 usually means most holders are underwater; above 3.5 suggests broad profits and overheated valuation."],
      confluence: "A historical accumulation window requires four-way confirmation: MVRV <1, Puell <0.5, Extreme Fear, and price near the 200 WMA."
    },
    balancedPrice: {
      title: "Balanced Price",
      summary: "A fair-value reference calculated as realized price minus transferred price.",
      points: ["Historical cycle bottoms have often formed near this level.", "The dashboard’s Price / BP value shows BTC price as a multiple of Balanced Price."]
    },
    puell: {
      title: "Puell Multiple",
      summary: "The USD value of daily BTC issuance divided by its 365-day average, used to measure miner revenue stress.",
      points: ["<0.5: severe miner stress, historically common near major cycle bottoms.", ">4: unusually high miner income and rising top risk."],
      confluence: "A historical accumulation window requires four-way confirmation: MVRV <1, Puell <0.5, Extreme Fear, and price near the 200 WMA."
    },
    sopr: {
      title: "SOPR (Spent Output Profit Ratio)",
      summary: "Measures the aggregate profit or loss realized by coins sold on-chain relative to their acquisition cost.",
      points: ["Below 1: aggregate selling at a loss, often associated with capitulation; above 1: aggregate selling in profit.", "A recovery after a prolonged period below 1 can signal bottom repair."]
    },
    ahr999: {
      title: "ahr999 DCA Index",
      summary: "Combines BTC’s current price with its 200-day dollar-cost-averaging basis to assess accumulation value.",
      points: ["<0.45: deep-value zone; 0.45–1.2: regular accumulation zone.", ">1.2: price is relatively expensive, so chasing requires caution."]
    },
    trueMarketMean: {
      title: "True Market Mean",
      summary: "The aggregate on-chain cost basis of active investors, also known as the Active-Investor Price.",
      points: ["Formula: Investor Cap ÷ Active Supply.", "When BTC trades above it, the level may act as cost-basis support; when BTC trades below it, it may act as cost-basis resistance.", "It is an on-chain valuation reference, not a standalone guarantee of price reversal."]
    }
  }
};

const CARD_HELP_KEYS = { 1: "btcEtfFlows", 2: "strategyMnav", 4: "fedOfficialStance", 7: "mvrv", 8: "puell" };

export function indicatorHelp(language, key) {
  return INDICATOR_HELP[language]?.[key] ?? INDICATOR_HELP.zh[key] ?? null;
}

export function indicatorHelpKeyForCard(cardId) {
  return CARD_HELP_KEYS[Number(cardId)] ?? null;
}

export function indicatorHelpKeyForFact(cardId, text) {
  const value = String(text);
  if (Number(cardId) === 7 && /(?:价\s*\/\s*BP|Price\s*\/\s*BP)/i.test(value)) return "balancedPrice";
  if (Number(cardId) === 8 && /ahr999/i.test(value)) return "ahr999";
  return null;
}

const CARD_NAMES = {
  1: ["BTC ETF Flows", "ETF"], 2: ["Strategy mNAV", "mNAV"], 3: ["Stablecoin Market Cap", "Stablecoins"],
  4: ["Official Fed Stance", "Fed"], 5: ["DXY Dollar Index", "DXY"], 6: ["Gold", "Gold"],
  7: ["MVRV Z-Score", "MVRV"], 8: ["Puell Multiple", "Puell"], 9: ["Long/Short Ratio", "L/S Ratio"]
};

const EXACT_EN = new Map([
  ["ETF 资金连续净流入，机构配置需求保持强势。", "ETF flows remain net positive, signaling resilient institutional allocation demand."],
  ["ETF 资金连续净流入，机构配置需求保持支撑。", "ETF flows remain net positive, supporting institutional allocation demand."],
  ["ETF 资金连续净流出，机构配置需求转弱。", "ETF flows remain net negative, signaling weaker institutional allocation demand."],
  ["最新交易日 ETF 资金净流量持平。", "ETF net flows were flat on the latest trading day."],
  ["ETF 发布快照", "ETF published snapshot"], ["ETF 数据可能滞后", "ETF data may be stale"],
  ["采用 Strategy 2026-07-23 起最新口径：MSTR 股价 ÷ Net BTC Per Share ($)；数值来自官方看板。", "Uses Strategy's current methodology effective July 23, 2026: MSTR share price ÷ Net BTC Per Share ($). Values come directly from the official dashboard."],
  ["距 1.0 触发仅 2%，BTC 拉升带动回升，现金跑道健康。", "Only 2% below the 1.0 trigger; BTC strength is lifting mNAV and the cash runway remains healthy."],
  ["稳定币供给扩张", "Stablecoin supply expanding"], ["稳定币供给收缩", "Stablecoin supply contracting"],
  ["稳定币供给保持扩张，链上可用流动性改善。", "Stablecoin supply is expanding, improving deployable on-chain liquidity."],
  ["稳定币供给出现收缩，需关注链上流动性压力。", "Stablecoin supply is contracting; monitor on-chain liquidity pressure."],
  ["降息预期升温 · 宽松预期延续", "Rate-cut expectations rising · Easing outlook intact"],
  ["关注 FOMC 与 CME FedWatch", "Watch the FOMC and CME FedWatch"],
  ["市场定价指向更友好的流动性环境，但需跟踪官方表态。", "Market pricing points to a friendlier liquidity backdrop, subject to official guidance."],
  ["FOMC 集体决策决定状态灯；主席讲话仅作语气辅助，不能覆盖实际利率行动。", "The collective FOMC decision sets the status; Chair remarks are secondary tone context and cannot override the actual rate action."],
  ["守在 100 下方", "Holding below 100"], ["升至 100 上方", "Above 100"], ["风险资产顺风", "Tailwind for risk assets"], ["美元走强施压", "Dollar strength pressures risk assets"],
  ["美元指数维持弱势，为风险资产提供宏观顺风。", "A softer dollar remains a macro tailwind for risk assets."],
  ["美元指数走强，风险资产的流动性环境承压。", "A stronger dollar is tightening the liquidity backdrop for risk assets."],
  ["日内走强", "Stronger on the day"], ["日内回落", "Lower on the day"], ["较发布值走强", "Stronger vs published"], ["较发布值回落", "Lower vs published"],
  ["同步观察实际利率", "Watch real yields alongside"], ["黄金用于交叉验证美元、实际利率与避险需求的变化。", "Gold cross-checks moves in the dollar, real yields and safe-haven demand."],
  ["价 / BP 1.94x", "Price / BP 1.94x"], ["低估累积区", "Undervalued accumulation zone"],
  ["估值仍在偏低区域，但尚未进入 Z-Score < 0 的历史极值区。", "Valuation remains low, but has not reached the historical extreme of Z-Score < 0."],
  ["获利主导", "Profit-taking dominant"], ["算力 920.8 EH/s", "Hashrate 920.8 EH/s"],
  ["矿工承压偏底部，SOPR 转强，仍处定投友好区。", "Miner stress remains near cycle lows, SOPR is firming, and the zone remains DCA-friendly."],
  ["机构锁仓做多（S+级）", "Institutional locked-long structure (S+)"], ["多头拥挤", "Crowded longs"], ["结构中性", "Neutral structure"],
  ["账户比偏低而大户仓位比偏高，落入机构锁仓象限。", "A low account ratio and high whale position ratio place the market in the institutional locked-long quadrant."],
  ["账户比下降而仓位比上升，大户重仓、散户冷静，落入机构锁仓象限。", "The account ratio is lower while the position ratio is higher: whales are heavily positioned and retail remains restrained."],
  ["账户与仓位同步偏多，需警惕杠杆拥挤。", "Accounts and positions are both long-biased; watch for leverage crowding."],
  ["账户与仓位差异不显著，暂无强结构信号。", "The account/position divergence is limited, with no strong structural signal."],
  ["财政部回购安排 → 关注对市场流动性的边际影响", "Treasury buybacks → watch the marginal liquidity impact"],
  ["CLARITY 法案进度 → 关注监管确定性", "CLARITY Act progress → watch regulatory certainty"],
  ["Puell 仍在观察区，矿工端压力尚未完全解除", "Puell remains in the watch zone; miner-side pressure has not fully eased."],
  ["Strategy mNAV 低于 1.0，市场价格低于 Net BPS 参考线", "Strategy mNAV is below 1.0, so the market price is below the Net BPS reference."],
  ["访客手工维护", "Visitor-maintained"], ["ECB 推导", "ECB-derived"], ["黄金", "Gold"], ["稳定币", "Stablecoins"], ["多空比", "L/S Ratio"], ["SOPR强", "SOPR strong"]
  , ["极度贪婪", "Extreme greed"], ["贪婪", "Greed"], ["中性", "Neutral"], ["恐惧", "Fear"], ["极度恐惧", "Extreme fear"]
]);

export function getInitialLanguage(storage = globalThis.localStorage) {
  try { return storage?.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh"; } catch { return "zh"; }
}

export function t(language, key, variables = {}) {
  let value = MESSAGES[language]?.[key] ?? MESSAGES.zh[key] ?? key;
  for (const [name, replacement] of Object.entries(variables)) value = value.replaceAll(`{${name}}`, replacement);
  return value;
}

export function statusLabel(language, status) {
  return t(language, { green: "statusGreen", yellow: "statusYellow", red: "statusRed", off: "statusOff" }[status]);
}

export function translateText(value, language) {
  if (language !== "en" || value == null) return value;
  const source = String(value);
  if (EXACT_EN.has(source)) return EXACT_EN.get(source);
  let text = source
    .replace(/涨跌基准暂不可用/g, "Comparison baseline unavailable")
    .replace(/较前收/g, "vs previous close")
    .replace(/较上个日终/g, "vs prior daily reference")
    .replace(/较基准走强/g, "Stronger vs reference")
    .replace(/较基准回落/g, "Lower vs reference")
    .replace(/黄金期货/g, "Gold futures")
    .replace(/黄金现货/g, "Spot gold")
    .replace(/\$([\d,.]+)\s*亿/g, (_, number) => `$${(Number(number.replaceAll(",", "")) / 10).toLocaleString("en-US", { maximumFractionDigits: 1 })}B`)
    .replace(/连续\s*(\d+)\s*日净流入/g, "$1 consecutive days of net inflows")
    .replace(/连续\s*(\d+)\s*日净流出/g, "$1 consecutive days of net outflows")
    .replace(/最新交易日净流量持平/g, "Latest trading-day net flow was flat")
    .replace(/ETF 发布快照/g, "ETF published snapshot")
    .replace(/ETF 数据可能滞后/g, "ETF data may be stale")
    .replace(/Fed 官方数据可能滞后/g, "Official Fed data may be stale")
    .replace(/维持利率/g, "Held rates")
    .replace(/降息/g, "Rate cut")
    .replace(/加息/g, "Rate hike")
    .replace(/目标区间/g, "Target range")
    .replace(/主席基调偏鹰/g, "Chair tone hawkish")
    .replace(/主席基调偏鸽/g, "Chair tone dovish")
    .replace(/主席基调中性/g, "Chair tone neutral")
    .replace(/主席偏鹰/g, "Chair hawkish")
    .replace(/主席偏鸽/g, "Chair dovish")
    .replace(/主席中性/g, "Chair neutral")
    .replace(/主席\s+/g, "Chair ")
    .replace(/基调偏鹰/g, "Hawkish tone")
    .replace(/基调偏鸽/g, "Dovish tone")
    .replace(/基调中性/g, "Neutral tone")
    .replace(/下次会议/g, "Next meeting")
    .replace(/按 Strategy 2026-07-23 起最新口径估算：MSTR 股价 ÷ Net BTC Per Share \(\$\)；资本结构采用 (\d{4}-\d{2}-\d{2}) 官方披露，行情自动更新。/g, "Estimated using Strategy's current methodology effective July 23, 2026: MSTR share price ÷ Net BTC Per Share ($). Capital structure uses the official $1 disclosure; market prices update automatically.")
    .replace(/Strategy 官方看板/g, "Strategy official dashboard")
    .replace(/Strategy 官方口径/g, "Strategy official methodology")
    .replace(/行情截至/g, "Market as of")
    .replace(/资本结构截至/g, "Capital structure as of")
    .replace(/净 BTC/g, "Net BTC")
    .replace(/最新口径/g, "Current methodology")
    .replace(/累计/g, "total")
    .replace(/连续(\d+)日/g, "$1-day streak")
    .replace(/飞轮/g, "Flywheel")
    .replace(/现金/g, "Cash")
    .replace(/单券 Runway ([\d.]+)月/g, "Single-security runway $1 mo")
    .replace(/全局 Runway ([\d.]+)月/g, "Overall runway $1 mo")
    .replace(/最近数据/g, "Latest data")
    .replace(/较发布值/g, "vs published")
    .replace(/较上次/g, "vs previous")
    .replace(/账户比/g, "Account ratio")
    .replace(/仓位比/g, "Position ratio")
    .replace(/仓帐比/g, "Position/account")
    .replace(/获利主导/g, "Profit-taking dominant")
    .replace(/算力/g, "Hashrate")
    .replace(/低估累积区/g, "Undervalued accumulation zone")
    .replace(/距 1\.0 触发仅 2%/g, "Only 2% below the 1.0 trigger")
    .replace(/BTC 拉升带动回升/g, "BTC strength is lifting the ratio")
    .replace(/现金跑道健康/g, "cash runway is healthy")
    .replace(/跑道健康/g, "runway is healthy")
    .replace(/飞轮效应仍待确认/g, "the flywheel effect is not yet confirmed")
    .replace(/仍在观察区，矿工端压力尚未完全解除/g, "remains in the watch zone; miner-side pressure has not fully eased")
    .replace(/极度贪婪——情绪进入偏热区，注意追高风险/g, "Extreme greed — sentiment is hot; avoid chasing strength")
    .replace(/贪婪——情绪进入偏热区，注意追高风险/g, "Greed — sentiment is hot; avoid chasing strength")
    .replace(/24h 上涨 ([\d.]+)%/g, "rose $1% in 24h")
    .replace(/短线波动放大，需留意获利盘承接/g, "short-term volatility is elevated; watch absorption of profit-taking")
    .replace(/黄金/g, "Gold")
    .replace(/稳定币/g, "Stablecoins")
    .replace(/机构锁仓做多（S\+级）/g, "Institutional locked-long structure (S+)")
    .replace(/Cashrunway/g, "Cash runway").replace(/Position\/account(?=\d)/g, "Position/account ")
    .replaceAll("——", " — ").replaceAll("，", ", ").replaceAll("：", ": ").replaceAll("（", " (").replaceAll("）", ")").replaceAll("。", ".");
  return text;
}

function englishSummary(data) {
  const counts = data.counts;
  const capital = data.cards.filter((item) => item.section === "capital");
  const capitalGreen = capital.filter((item) => item.status === "green").length;
  const positioning = data.cards.find((item) => item.id === 9);
  const direction = counts.red === 0 && counts.green >= 5 ? "a bullish bias" : counts.red >= 3 ? "a risk-dominant regime" : "a mixed regime";
  const mood = data.market.fng >= 70 ? "hot, reducing the reward-to-risk of chasing strength" : "not yet at an extreme";
  const structure = positioning?.status === "green"
    ? `Derivatives positioning is bullish (${translateText(positioning.headline, "en")}), while concentrated leverage can amplify reversals.`
    : "Derivatives positioning has not formed a clear directional signal.";
  return `The dashboard has ${counts.green}/${data.total} active signals and ${counts.red} red flags, indicating ${direction}. Capital indicators have ${capitalGreen}/${capital.length} active signals; assess ETF flows, stablecoin supply and mNAV separately. Sentiment is ${mood}. ${structure}`;
}

export function localizeDashboard(data, language) {
  if (language !== "en") return data;
  const cards = data.cards.map((card) => ({
    ...card,
    title: CARD_NAMES[card.id]?.[0] || translateText(card.title, language),
    shortName: CARD_NAMES[card.id]?.[1] || translateText(card.shortName, language),
    headline: translateText(card.headline, language), facts: card.facts.map((item) => translateText(item, language)),
    detail: translateText(card.detail, language), change: translateText(card.change, language),
    source: { ...card.source, label: translateText(card.source?.label, language) }
  }));
  const localized = { ...data, cards, dataMode: translateMode(data.dataMode, language), heat: { ...data.heat, label: translateText(data.heat.label, language) } };
  localized.summary = englishSummary({ ...localized, cards });
  localized.risks = data.risks.map((item) => translateText(item, language));
  localized.macroNotes = data.macroNotes.map((item) => translateText(item, language));
  localized.previous = { ...data.previous, changes: buildCurrentChanges(localized, "en").map((item) => translateText(item, language)) };
  return localized;
}

export function translateMode(mode, language) {
  if (language !== "en") return mode;
  return String(mode)
    .replace("本地维护 + 实时数据", "Local override + live data")
    .replace("本地维护 + 混合数据", "Local override + mixed data")
    .replace("本地维护 + 公开快照", "Local override + public snapshot")
    .replace("公开实时数据", "Public live data").replace("公开混合数据", "Public mixed data").replace("公开快照", "Public snapshot")
    .replace("实时数据", "Live data").replace("混合数据", "Mixed data");
}
