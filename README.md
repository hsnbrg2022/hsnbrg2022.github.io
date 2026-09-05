# 加密看板追踪器

公开只读版加密市场看板，发布于 GitHub Pages。

访问地址：<https://hsnbrg2022.github.io/>

公开访客可通过页面右上角的“刷新最新数据”按钮获取 ETF、Strategy mNAV、BTC、F&G、稳定币、Fed、True Market Mean、DXY、黄金和 200WMA。Strategy mNAV 使用 2026-07-23 起的最新官方定义：`MSTR 股价 ÷ Net Bitcoin Per Share ($)`，不再沿用旧 EV mNAV。页面读取仓库根目录的 `strategy-mnav.json` 自动快照；任务优先读取 Strategy 官方页面更新资本结构，官方页面受反爬限制时保留最近有效的官方资本结构，并用 Nasdaq（备用 mNAV.com / Yahoo Finance）与 DefiLlama（备用 Coinbase / Kraken）的行情重新计算。公式、日期或合理区间校验失败时不会覆盖上一次有效值。MVRV、Puell 与多空比继续使用发布时的手工口径。

Strategy mNAV 快照由 `.github/workflows/update-strategy-mnav.yml` 在美股交易日收盘后运行 `scripts/update-strategy-mnav.mjs` 生成。卡片会同时标注行情日期与资本结构基准日；当官方资本结构暂时无法重新读取时，它属于“最新官方口径估算”，不是 Strategy 官方页面的逐字转录值。

Fed 卡片读取同源 `fed-signals.json`。`.github/workflows/update-fed-signals.yml` 每小时检查 Federal Reserve 官方货币政策 RSS、公告原文、主席讲话与 FOMC 会议日历；只有官方事件发生变化时才提交新数据。状态灯只由 FOMC 集体行动决定（降息绿、维持黄、加息红），主席讲话仅作偏鹰/偏鸽/中性的辅助语气，不覆盖实际利率决策。抓取或解析失败时任务不会覆盖最后有效快照。

ETF 数据来自同源的 `etf-flows.json`。页面会自动计算连续净流入/流出、累计金额与卡片状态；周末不会把周五数据误判为过期，超过 2 个工作日仍无新数据时会明确提示可能滞后。未配置自动接口时，页面显示“发布快照”，不会把它伪装成实时数据。

仓库中的 `.github/workflows/update-etf-flows.yml` 会在美股交易日后的亚洲时段运行，`.github/workflows/update-fed-signals.yml` 每小时检查官方 Fed 更新。上传到 GitHub 时必须保留仓库根目录下的隐藏目录 `.github`，否则定时任务不会出现。

没有 API Key 时，在本地维护版点击 ETF 卡片右上角“手动维护”，从 SoSoValue 或 Farside 核对后录入交易日期与当日总净流量。保存会自动生成本目录的 `etf-flows.json` 和 `dashboard.json`；将这两个文件上传到 GitHub 仓库根目录即可发布。系统会自动计算连续方向、累计金额和信号状态，同日重录会覆盖旧值。

ETF 维护窗口中的最近记录可直接点击并回填。修正金额后保存会覆盖该交易日的原记录，不会生成重复日期；修改状态、保存按钮和成功提示均会明确标识这是二次修改。

如以后取得 API Key，可在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加 `COINGLASS_API_KEY`。自动任务使用 CoinGlass 官方 ETF Flow API，并保留 Farside 作为人工复核链接。Farside 会拦截 GitHub 服务器的直接抓取，因此不作为无密钥 API 使用。还可以通过 `ETF_FLOW_BACKUP_URL` 与可选的 `ETF_FLOW_BACKUP_KEY` 配置备用 JSON 接口。主数据源失败时会自动尝试备用源；两个数据源都未配置或全部失败时，任务会明确失败，不再伪装成成功更新。

True Market Mean 在 `dashboard.json` 的 `trueMarketMean` 字段中维护：更新 `value` 和 `asOf` 即可。页面会使用实时 BTC 自动计算距离，并判断该成本线处于下方支撑、上方阻力或正在测试；超过 3 天提示可能滞后，超过 7 天提示数据过期。

True Market Mean 已启用自动更新：`.github/workflows/update-true-market-mean.yml` 每日通过 Glassnode Public MCP 读取同一 UTC 日的 BTC 收盘价和 AVIV，并按 `BTC 收盘价 ÷ AVIV` 生成 `true-market-mean.json`。网页打开和手动刷新时会校验并读取该文件；数据滞后超过 3 天、超出合理范围、公式不一致或较上一快照跳变超过 10% 时不会覆盖最近有效值，首次读取失败则回退到 `dashboard.json` 的人工发布值。该方案无需 API Key。

“多空比”卡片支持访客手动维护账户比与仓位比，仓帐比和信号等级自动计算。访客数据仅保存在自己的浏览器，可随时恢复发布值。

本地预览与 GitHub Pages 现在使用本目录中的同一套前端。环境差异仅体现在保存策略：本地 `127.0.0.1` 是维护者模式，ETF 和多空比保存会更新发布 JSON；GitHub Pages 是公开模式，这两项手工维护均只保存在当前访客浏览器，不写回 GitHub、不影响其他访客。全局 ETF 数据仍以仓库根目录的 `etf-flows.json` 和 `dashboard.json` 为准。

页面每次打开会自动刷新一次公开实时数据，并将更新时间定格为刷新完成时的北京时间（UTC+8）。

页面支持中文与英文切换，新访客默认中文；语言选择保存在当前浏览器，不影响行情数据和手工维护值。

## 一键同步 GitHub

发布前请停止本地维护服务，发布期间不要编辑本地 JSON；当前发布器与维护服务尚未共用跨进程写入锁。发布器会对照远端与私有同步基线，保留较新的自动快照；同一字段或同一 ETF 日期的双端冲突会停止发布，不会强行覆盖。回收前备份与同步基线保存在网站之外的 `../crypto-dashboard/.publish-backups/` 和 `.publish-state.json`，不要上传这两项。

项目使用 `scripts/publish-github.mjs` 将本目录中的公开文件原子同步到 GitHub Pages 仓库。脚本会自动包含 `.github`、`.nojekyll` 和后续新增的公开文件，并排除 `.git`、`.env`、私钥及本地依赖目录；远端独有文件不会被删除。

首次使用时创建一个仅授权 `hsnbrg2022.github.io` 仓库、权限为 **Contents: Read and write** 的 fine-grained personal access token，然后执行以下命令。命令会等待你在隐藏提示中输入 token，并将其存入 macOS 钥匙串，token 不会写入项目文件：

```bash
security add-generic-password -U -a hsnbrg2022 -s crypto-dashboard-github -w
```

以后双击本目录的 `publish-github.command`，或在终端执行 `./publish-github.command`，即可先运行全部测试、再同步全部公开文件；添加 `--dry-run` 参数可只查看同步清单。发布成功后脚本会显示 GitHub 提交链接，GitHub Pages 通常还需要短暂时间完成部署。

仅供研究与信息整理，不构成投资建议。

## 2026-09-05 第一批可靠性优化

- 黄金不再用卡片旧文案作为比较价格；期货仅与该合约前收比较，现货源没有可核实涨跌基准时显示“观察 / 涨跌基准暂不可用”，重复刷新不会凭空变绿。DXY 汇率推导值会标明日终参考口径。
- 接口失败后成功读取会清除失败标记；ETF、Fed 自身的过期判断仍保留。成功抓取不代表业务数据一定是当日数据。
- “基线对比与当前信号”根据当前数值重新生成，明确区分历史基线比较和当前卡片状态；不再展示保存时残留的旧日报。
- Fed 解析支持维持、加息和降息公告，决策与利率区间必须来自同一正式决策句；历史和异议段落不作为本次决策。
- 本地保存使用串行事务、独立临时文件与普通失败回滚；刷新期间保存的手工值不会被延迟响应覆盖。它不是断电恢复机制，也不支持多个服务进程同时写入。

后续批次再处理统一新鲜度评分、公开 ETF 按日期覆盖、ETF 交易日连续性、200WMA 样本校验及历史基线；本批不改这些算法的业务规则。
