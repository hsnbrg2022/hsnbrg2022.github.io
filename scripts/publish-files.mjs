import { lstat } from "node:fs/promises";
import path from "node:path";

// New public resources must be added explicitly. Never discover uploads by glob.
export const PUBLICATION_FILES = Object.freeze([
  ".github/workflows/update-etf-flows.yml",
  ".github/workflows/update-fed-signals.yml",
  ".github/workflows/update-onchain.yml",
  ".github/workflows/update-strategy-mnav.yml",
  ".github/workflows/update-true-market-mean.yml",
  ".github/workflows/update-weekly-mean.yml",
  ".nojekyll",
  "app.js", "dashboard.json", "data-quality.js", "etf-core.js", "etf-flows.json",
  "etf-overrides.js", "fed-signals.js", "fed-signals.json", "i18n.js", "index.html",
  "macro-quote.js", "mnav-source.js", "model.js", "mvrv.json", "og.png", "onchain-source.js",
  "package.json", "public-refresh.js", "publish-github.command", "puell.json", "README.md",
  "scripts/manual-etf-flow.mjs", "scripts/publish-files.mjs", "scripts/publish-github.mjs",
  "scripts/publish-merge.mjs", "scripts/update-etf-flows.mjs", "scripts/update-fed-signals.mjs",
  "scripts/update-onchain.mjs", "scripts/update-strategy-mnav.mjs", "scripts/update-true-market-mean.mjs",
  "scripts/update-weekly-mean.mjs", "scripts/write-lock.mjs", "stablecoin-source.js", "strategy-mnav.json", "styles.css",
  "trading-calendar.js", "true-market-mean.js", "true-market-mean.json", "weekly-mean.js", "weekly-mean.json"
]);

export async function collectPublicationFiles(root) {
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("发布根目录必须为真实目录");
  const files = [];
  for (const relativePath of PUBLICATION_FILES) {
    const parts = relativePath.split("/");
    let absolutePath = root;
    for (let index = 0; index < parts.length; index++) {
      absolutePath = path.join(absolutePath, parts[index]);
      let stat;
      try { stat = await lstat(absolutePath); }
      catch (error) {
        if (error.code === "ENOENT") throw new Error(`发布清单文件缺失：${relativePath}`);
        throw error;
      }
      if (stat.isSymbolicLink()) throw new Error(`发布清单禁止符号链接：${relativePath}`);
      if (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory()) throw new Error(`发布清单文件类型无效：${relativePath}`);
    }
    files.push({ relativePath, absolutePath });
  }
  return files;
}
