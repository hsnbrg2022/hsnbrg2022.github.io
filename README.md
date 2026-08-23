# 加密看板追踪器

公开只读版加密市场看板，发布于 GitHub Pages。

访问地址：<https://hsnbrg2022.github.io/>

公开访客可通过页面右上角的“刷新最新数据”按钮获取 ETF、BTC、F&G、稳定币、DXY、黄金和 200WMA。mNAV、Fed、MVRV、Puell、True Market Mean 与多空比继续使用发布时的手工口径。

ETF 数据来自同源的 `etf-flows.json`。页面会自动计算连续净流入/流出、累计金额与卡片状态；周末不会把周五数据误判为过期，超过 2 个工作日仍无新数据时会明确提示可能滞后。未配置自动接口时，页面显示“发布快照”，不会把它伪装成实时数据。

仓库中的 `.github/workflows/update-etf-flows.yml` 会在美股交易日后的亚洲时段运行。请在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加 `COINGLASS_API_KEY`。自动任务使用 CoinGlass 官方 ETF Flow API，并保留 Farside 作为人工复核链接。还可以通过 `ETF_FLOW_BACKUP_URL` 与可选的 `ETF_FLOW_BACKUP_KEY` 配置备用 JSON 接口。

True Market Mean 在 `dashboard.json` 的 `trueMarketMean` 字段中维护：更新 `value` 和 `asOf` 即可。页面会使用实时 BTC 自动计算距离，并判断该成本线处于下方支撑、上方阻力或正在测试；超过 3 天提示可能滞后，超过 7 天提示数据过期。

“多空比”卡片支持访客手动维护账户比与仓位比，仓帐比和信号等级自动计算。访客数据仅保存在自己的浏览器，可随时恢复发布值。

页面每次打开会自动刷新一次公开实时数据，并将更新时间定格为刷新完成时的北京时间（UTC+8）。

页面支持中文与英文切换，新访客默认中文；语言选择保存在当前浏览器，不影响行情数据和手工维护值。

仅供研究与信息整理，不构成投资建议。
