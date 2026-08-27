#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const OWNER = "hsnbrg2022";
const REPO = "hsnbrg2022.github.io";
const BRANCH = "main";
const KEYCHAIN_ACCOUNT = OWNER;
const KEYCHAIN_SERVICE = "crypto-dashboard-github";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;

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
  --dry-run        仅列出待同步文件，不连接 GitHub
  -m, --message    自定义提交说明
  -h, --help       显示帮助

凭据优先读取 GITHUB_TOKEN；未设置时读取 macOS 钥匙串服务：
  ${KEYCHAIN_SERVICE}`);
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

function gitBlobSha(content) {
  const header = Buffer.from(`blob ${content.length}\0`);
  return createHash("sha1").update(header).update(content).digest("hex");
}

async function publish(files, token, message) {
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
  const changedFiles = localFiles.filter(
    ({ relativePath, sha }) => remoteBlobShas.get(relativePath) !== sha,
  );

  if (changedFiles.length === 0) {
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
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const files = await collectFiles();
  if (options.dryRun) {
    console.log(`将同步 ${files.length} 个文件：`);
    files.forEach(({ relativePath }) => console.log(relativePath));
    return;
  }

  if (files.length === 0) throw new Error("没有找到可同步的公开文件。");
  const token = readToken();
  if (!token) throw new Error("GitHub 凭据为空，请重新保存到钥匙串。");
  await publish(files, token, options.message.trim() || defaultCommitMessage());
}

main().catch((error) => {
  console.error(`发布失败：${error.message}`);
  process.exitCode = 1;
});
