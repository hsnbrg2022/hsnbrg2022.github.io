#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { readdir, readFile, mkdir, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { gitBlobSha, planPublication, PROTECTED_DATA_FILES } from "./publish-merge.mjs";

const OWNER = "hsnbrg2022";
const REPO = "hsnbrg2022.github.io";
const BRANCH = "main";
const KEYCHAIN_ACCOUNT = OWNER;
const KEYCHAIN_SERVICE = "crypto-dashboard-github";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;
const STATE_DIR = path.resolve(ROOT, "../crypto-dashboard");
const STATE_FILE = path.join(STATE_DIR, ".publish-state.json");
const TARGET = `${OWNER}/${REPO}/${BRANCH}`;

const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules"]);
const EXCLUDED_FILES = new Set([".DS_Store", ".env"]);
const EXCLUDED_SUFFIXES = [".pem", ".key", ".p12", ".pfx"];

function parseArguments(argv) {
  const options = { dryRun: false, help: false, message: "" };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--message" || argument === "-m") {
      options.message = argv[index + 1] ?? "";
      index += 1;
    } else if (argument.startsWith("--message=")) {
      options.message = argument.slice("--message=".length);
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`用法：node scripts/publish-github.mjs [选项]

选项：
  --dry-run        仅列出候选文件，不连接 GitHub、读取凭据或改动文件
  -m, --message    自定义提交说明
  -h, --help       显示帮助

凭据优先读取 GITHUB_TOKEN；未设置时读取 macOS 钥匙串服务：
  ${KEYCHAIN_SERVICE}

正式发布会对照上次同步基线；自动数据冲突或日期回退时停止。
基线与回收前备份保存在网站目录之外：${STATE_DIR}
发布前请暂停本地维护服务；发布与手工保存暂不支持跨进程并发。`);
}

function isSensitiveOrTemporaryFile(name) {
  if (EXCLUDED_FILES.has(name) || name.startsWith(".env.")) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => name.toLowerCase().endsWith(suffix));
}

async function collectFiles(directory = ROOT, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        files.push(...(await collectFiles(absolutePath, relativePath)));
      }
    } else if (entry.isFile() && !isSensitiveOrTemporaryFile(entry.name)) {
      files.push({ relativePath, absolutePath });
    }
  }

  return files;
}

function readToken() {
  const environmentToken = process.env.GITHUB_TOKEN?.trim();
  if (environmentToken) return environmentToken;

  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", KEYCHAIN_SERVICE, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    throw new Error(
      `未找到 GitHub 凭据。请先执行：\nsecurity add-generic-password -U -a ${KEYCHAIN_ACCOUNT} -s ${KEYCHAIN_SERVICE} -w`,
    );
  }
}

async function githubRequest(token, endpoint, options = {}) {
  const response = await fetch(`${API_ROOT}${endpoint}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "crypto-dashboard-publisher",
      ...options.headers,
    },
  });
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const detail = payload.message ? `：${payload.message}` : "";
    const method = options.method ?? "GET";
    const requiredPermissions = response.headers.get("x-accepted-github-permissions");
    const permissionDetail = requiredPermissions ? `（需要 ${requiredPermissions}）` : "";
    throw new Error(
      `GitHub API ${method} ${endpoint} → ${response.status} ${response.statusText}${detail}${permissionDetail}`,
    );
  }

  return payload;
}

async function inBatches(items, batchSize, task) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...(await Promise.all(batch.map(task))));
  }
  return results;
}

function defaultCommitMessage() {
  const updatedAt = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
  }).format(new Date());
  return `更新加密看板（${updatedAt}）`;
}

async function readBaseline() {
  let text;
  try { text = await readFile(STATE_FILE, "utf8"); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  const baseline = JSON.parse(text);
  if (baseline.version !== 1 || baseline.target !== TARGET || !baseline.files || !baseline.data) {
    throw new Error("发布基线格式或目标不匹配，已停止发布；请核对 .publish-state.json。");
  }
  for (const [file, content] of Object.entries(baseline.data)) {
    if (!PROTECTED_DATA_FILES.has(file) || gitBlobSha(content) !== baseline.files[file]) {
      throw new Error(`发布基线 ${file} 校验失败，已停止发布。`);
    }
  }
  return baseline;
}

async function writeAtomic(file, content) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporaryFile, content);
  await rename(temporaryFile, file);
}

async function finishSynchronization(plannedFiles, remoteBlobShas, commitSha) {
  const backupRoot = path.join(STATE_DIR, ".publish-backups", `${Date.now()}-${randomUUID()}`);
  const baseline = { version: 1, target: TARGET, commit: commitSha, files: Object.fromEntries(remoteBlobShas), data: {} };
  let concurrentEdit = false;
  for (const file of plannedFiles) {
    baseline.files[file.relativePath] = file.sha;
    if (PROTECTED_DATA_FILES.has(file.relativePath)) baseline.data[file.relativePath] = file.content.toString("utf8");
  }
  for (const file of plannedFiles.filter((item) => item.sha !== item.originalSha)) {
    const current = await readFile(file.absolutePath);
    if (gitBlobSha(current) !== file.originalSha) {
      concurrentEdit = true;
      console.warn(`保留发布期间的新本地修改：${file.relativePath}；下次发布将重新合并。`);
      continue;
    }
    const backupPath = path.join(backupRoot, file.relativePath);
    await writeAtomic(backupPath, current);
    // Recheck after backup I/O so a just-saved maintenance entry is not overwritten.
    if (gitBlobSha(await readFile(file.absolutePath)) !== file.originalSha) {
      concurrentEdit = true;
      console.warn(`保留发布期间的新本地修改：${file.relativePath}；备份位于 ${backupPath}`);
      continue;
    }
    await writeAtomic(file.absolutePath, file.content);
    console.log(`已回收 GitHub 新版本：${file.relativePath}（原文件备份：${backupPath}）`);
  }
  // Advance only after recovery. Keeping the old baseline on an interrupted
  // recovery lets the next run merge pending local edits against their real base.
  if (!concurrentEdit) await writeAtomic(STATE_FILE, `${JSON.stringify(baseline, null, 2)}\n`);
  else console.warn("发布期间检测到本地维护，保留原同步基线供下次三方合并。");
}

async function publish(files, token, message) {
  console.warn("发布期间请勿运行本地手工维护；回收文件与维护保存暂不支持跨进程并发。");
  const baseline = await readBaseline();
  const reference = await githubRequest(token, `/git/ref/heads/${BRANCH}`);
  const parentSha = reference.object.sha;
  const parentCommit = await githubRequest(token, `/git/commits/${parentSha}`);
  const remoteTree = await githubRequest(token, `/git/trees/${parentCommit.tree.sha}?recursive=1`);
  if (remoteTree.truncated) {
    throw new Error("GitHub 文件树过大且返回结果不完整，已停止发布以避免误覆盖。");
  }

  const remoteBlobShas = new Map(
    remoteTree.tree
      .filter((entry) => entry.type === "blob")
      .map((entry) => [entry.path, entry.sha]),
  );
  const localFiles = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file.absolutePath);
      return { ...file, content, sha: gitBlobSha(content) };
    }),
  );
  const remoteFiles = new Map();
  await inBatches(localFiles, 4, async (file) => {
    const sha = remoteBlobShas.get(file.relativePath);
    if (!sha) return;
    let content = file.content;
    if (sha !== file.sha) {
      const blob = await githubRequest(token, `/git/blobs/${sha}`);
      if (blob.encoding !== "base64") throw new Error(`GitHub ${file.relativePath} 返回了不支持的内容格式。`);
      content = Buffer.from(blob.content, "base64");
      if (gitBlobSha(content) !== sha) throw new Error(`GitHub ${file.relativePath} 内容校验失败。`);
    }
    remoteFiles.set(file.relativePath, { sha, content });
  });
  const plannedFiles = planPublication(localFiles, remoteFiles, baseline);
  const changedFiles = plannedFiles.filter(
    ({ relativePath, sha }) => remoteBlobShas.get(relativePath) !== sha,
  );

  if (changedFiles.length === 0) {
    await finishSynchronization(plannedFiles, remoteBlobShas, parentSha);
    console.log("GitHub 已是最新版本，无需提交。");
    return;
  }

  console.log(`正在同步 ${changedFiles.length}/${files.length} 个有变化的公开文件……`);
  const treeEntries = await inBatches(changedFiles, 1, async ({ relativePath, content }) => {
    try {
      const blob = await githubRequest(token, "/git/blobs", {
        method: "POST",
        body: JSON.stringify({ content: content.toString("base64"), encoding: "base64" }),
      });
      const mode = relativePath.endsWith(".command") ? "100755" : "100644";
      return { path: relativePath, mode, type: "blob", sha: blob.sha };
    } catch (error) {
      throw new Error(`同步 ${relativePath} 失败：${error.message}`);
    }
  });

  const tree = await githubRequest(token, "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: parentCommit.tree.sha, tree: treeEntries }),
  });

  const commit = await githubRequest(token, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }),
  });
  await githubRequest(token, `/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  console.log(`同步完成：${commit.html_url}`);
  console.log(`本次上传：${changedFiles.map((file) => file.relativePath).join("、")}`);
  try { await finishSynchronization(plannedFiles, remoteBlobShas, commit.sha); }
  catch (error) { throw new Error(`GitHub 已提交 ${commit.sha}，但本地回收或基线保存失败：${error.message}`); }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const files = await collectFiles();
  if (options.dryRun) {
    console.log(`发现 ${files.length} 个候选文件；正式发布时会与 GitHub 及本地基线对照：`);
    files.forEach(({ relativePath }) => console.log(relativePath));
    return;
  }

  if (files.length === 0) throw new Error("没有找到可同步的公开文件。");
  const token = readToken();
  if (!token) throw new Error("GitHub 凭据为空，请重新保存到钥匙串。");
  await publish(files, token, options.message.trim() || defaultCommitMessage());
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`发布失败：${error.message}`);
    process.exitCode = 1;
  });
}
