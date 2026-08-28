# 加密看板追踪器

公开只读版加密市场看板，发布于 GitHub Pages。

访问地址：<https://hsnbrg2022.github.io/>

公开访客可通过页面右上角的“刷新最新数据”按钮获取 ETF、BTC、F&G、稳定币、DXY、黄金和 200WMA。mNAV、Fed、MVRV、Puell、True Market Mean 与多空比继续使用发布时的手工口径。

ETF 数据来自同源的 `etf-flows.json`。页面会自动计算连续净流入/流出、累计金额与卡片状态；周末不会把周五数据误判为过期，超过 2 个工作日仍无新数据时会明确提示可能滞后。未配置自动接口时，页面显示“发布快照”，不会把它伪装成实时数据。

仓库中的 `.github/workflows/update-etf-flows.yml` 会在美股交易日后的亚洲时段运行。上传到 GitHub 时必须保留仓库根目录下的隐藏目录 `.github`，否则定时任务不会出现。

没有 API Key 时，在本地维护版点击 ETF 卡片右上角“手动维护”，从 SoSoValue 或 Farside 核对后录入交易日期与当日总净流量。保存会自动生成本目录的 `etf-flows.json` 和 `dashboard.json`；将这两个文件上传到 GitHub 仓库根目录即可发布。系统会自动计算连续方向、累计金额和信号状态，同日重录会覆盖旧值。

ETF 维护窗口中的最近记录可直接点击并回填。修正金额后保存会覆盖该交易日的原记录，不会生成重复日期；修改状态、保存按钮和成功提示均会明确标识这是二次修改。

如以后取得 API Key，可在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加 `COINGLASS_API_KEY`。自动任务使用 CoinGlass 官方 ETF Flow API，并保留 Farside 作为人工复核链接。Farside 会拦截 GitHub 服务器的直接抓取，因此不作为无密钥 API 使用。还可以通过 `ETF_FLOW_BACKUP_URL` 与可选的 `ETF_FLOW_BACKUP_KEY` 配置备用 JSON 接口。主数据源失败时会自动尝试备用源；两个数据源都未配置或全部失败时，任务会明确失败，不再伪装成成功更新。

True Market Mean 在 `dashboard.json` 的 `trueMarketMean` 字段中维护：更新 `value` 和 `asOf` 即可。页面会使用实时 BTC 自动计算距离，并判断该成本线处于下方支撑、上方阻力或正在测试；超过 3 天提示可能滞后，超过 7 天提示数据过期。

“多空比”卡片支持访客手动维护账户比与仓位比，仓帐比和信号等级自动计算。访客数据仅保存在自己的浏览器，可随时恢复发布值。

本地预览与 GitHub Pages 现在使用本目录中的同一套前端。环境差异仅体现在保存策略：本地 `127.0.0.1` 是维护者模式，ETF 和多空比保存会更新发布 JSON；GitHub Pages 是公开模式，这两项手工维护均只保存在当前访客浏览器，不写回 GitHub、不影响其他访客。全局 ETF 数据仍以仓库根目录的 `etf-flows.json` 和 `dashboard.json` 为准。

页面每次打开会自动刷新一次公开实时数据，并将更新时间定格为刷新完成时的北京时间（UTC+8）。

页面支持中文与英文切换，新访客默认中文；语言选择保存在当前浏览器，不影响行情数据和手工维护值。

## 一键同步 GitHub

项目使用 `scripts/publish-github.mjs` 将本目录中的公开文件原子同步到 GitHub Pages 仓库。脚本会自动包含 `.github`、`.nojekyll` 和后续新增的公开文件，并排除 `.git`、`.env`、私钥及本地依赖目录；远端独有文件不会被删除。

首次使用时创建一个仅授权 `hsnbrg2022.github.io` 仓库、权限为 **Contents: Read and write** 的 fine-grained personal access token，然后执行以下命令。命令会等待你在隐藏提示中输入 token，并将其存入 macOS 钥匙串，token 不会写入项目文件：

```bash
security add-generic-password -U -a hsnbrg2022 -s crypto-dashboard-github -w
```

以后双击本目录的 `publish-github.command`，或在终端执行 `./publish-github.command`，即可先运行全部测试、再同步全部公开文件；添加 `--dry-run` 参数可只查看同步清单。发布成功后脚本会显示 GitHub 提交链接，GitHub Pages 通常还需要短暂时间完成部署。

仅供研究与信息整理，不构成投资建议。
