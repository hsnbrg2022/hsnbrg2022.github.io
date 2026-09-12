import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

function runGit(args) {
  return spawnSync("git", args, {
    encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" }
  });
}

// Called after a workflow has committed its own explicit file list. Never stage,
// force-push, resolve JSON conflicts or retry an ambiguous network result here.
export function pushSnapshot({ runGit: git = runGit, log = console.log } = {}) {
  const checked = args => {
    const result = git(args);
    if (result.error || result.status !== 0) throw new Error(`Git ${args[0]} 失败，已停止；请检查任务权限、网络或仓库状态。`);
    return result.stdout || "";
  };
  if (checked(["status", "--porcelain"]).trim()) throw new Error("存在未提交文件，已停止推送；不会自动暂存或覆盖。");
  if (checked(["symbolic-ref", "--short", "HEAD"]).trim() !== "main") throw new Error("仅允许 main 工作流分支推送。");
  if (checked(["rev-list", "--count", "refs/remotes/origin/main..HEAD"]).trim() !== "1") throw new Error("仅允许推送本次生成的一项快照提交。");

  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`推送快照：第 ${attempt}/3 次`);
    const push = git(["push", "--porcelain", "origin", "HEAD:refs/heads/main"]);
    if (!push.error && push.status === 0) { log("快照推送成功。"); return attempt; }
    // Parse only the machine-readable status. Do not print remote URLs/errors,
    // which may contain credentials, or mistake server-policy rejection for a race.
    const moved = !push.error && push.status === 1 && /^!\t[^\t]+:refs\/heads\/main\t\[rejected\] \((fetch first|non-fast-forward)\)$/m.test(push.stdout || "");
    if (!moved) throw new Error("推送未确认成功，已停止；权限、网络或远端策略错误不自动重试，请核对远端状态。");
    if (attempt === 3) throw new Error("远端持续更新，已尝试 3 次并停止；未强制覆盖，请在后续任务重试。");

    const parents = checked(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/);
    if (parents.length !== 2) throw new Error("快照提交不是单父提交，已停止自动重试。");
    const base = parents[1];
    checked(["fetch", "--no-tags", "origin", "refs/heads/main:refs/remotes/origin/main"]);
    const ancestor = git(["merge-base", "--is-ancestor", base, "refs/remotes/origin/main"]);
    if (ancestor.error || ancestor.status !== 0) throw new Error("远端历史已改变或无法确认，已停止自动重试。");
    const changed = ref => checked(["diff", "--name-only", "--no-renames", "-z", base, ref]).split("\0").filter(Boolean);
    const remoteFiles = new Set(changed("refs/remotes/origin/main"));
    const overlap = changed("HEAD").filter(file => remoteFiles.has(file));
    if (overlap.length) throw new Error(`双方修改同一文件，已停止，保留远端数据：${overlap.join("、")}`);

    const rebase = git(["rebase", "--no-autostash", "refs/remotes/origin/main"]);
    if (rebase.error || rebase.status !== 0) {
      git(["rebase", "--abort"]);
      throw new Error("变基失败，已尝试中止本次变基；未继续推送，请核对任务工作区。");
    }
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_ACTIONS !== "true") throw new Error("本脚本仅供 GitHub Actions 使用；本地请使用 publish-github.mjs。");
    pushSnapshot();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
