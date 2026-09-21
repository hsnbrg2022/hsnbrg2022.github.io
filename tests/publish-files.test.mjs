import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rename, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PUBLICATION_FILES, collectPublicationFiles } from "../scripts/publish-files.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "dashboard-publish-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of PUBLICATION_FILES) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, name === ".nojekyll" ? "" : "public fixture");
  }
  return root;
}

test("明确清单保留所有既有公开资源，包括隐藏.nojekyll和工作流", async t => {
  const root = await fixture(t);
  const files = await collectPublicationFiles(root);
  assert.equal(PUBLICATION_FILES.length, 62);
  assert.equal(new Set(PUBLICATION_FILES).size, PUBLICATION_FILES.length);
  assert.equal(Object.isFrozen(PUBLICATION_FILES), true);
  assert.deepEqual(files.map(file => file.relativePath), [...PUBLICATION_FILES]);
  assert.ok(files.some(file => file.relativePath === ".nojekyll"));
  assert.equal(files.filter(file => file.relativePath.startsWith(".github/workflows/")).length, 7);
  for (const file of files) assert.equal(file.absolutePath, path.join(root, file.relativePath));
});

test("凭据、备份、临时文件、私有数据及未知前端资源默认不在上传范围", async t => {
  const root = await fixture(t);
  const denied = [".env", ".env.local", ".ENV", "credentials.json", "token.txt", "id_rsa", "key.pem", "secret.KEY", ".publish-state.json", ".publish-backups/snapshot.json", "backup/dashboard.json", "data/history.json", "dashboard.json.bak", "app.js.tmp", "archive.zip", ".git/config", "node_modules/x.js", "new-widget.js", "scripts/debug.mjs", "tests/private.test.mjs", ".github/workflows/unreviewed.yml"];
  for (const name of denied) {
    const file = path.join(root, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "synthetic-private-fixture");
  }
  const files = await collectPublicationFiles(root);
  assert.equal(files.length, 62);
  for (const name of denied) assert.equal(files.some(file => file.relativePath === name), false);
  assert.equal(await readFile(path.join(root, "token.txt"), "utf8"), "synthetic-private-fixture");
});

test("必需文件缺失或类型错误时停止，不静默发布不完整网站", async t => {
  const root = await fixture(t);
  await rename(path.join(root, "app.js"), path.join(root, "app.js.backup"));
  await assert.rejects(() => collectPublicationFiles(root), /发布清单文件缺失：app.js/);
  await mkdir(path.join(root, "app.js"));
  await assert.rejects(() => collectPublicationFiles(root), /发布清单文件类型无效：app.js/);
});

test("清单文件、父目录及根目录的符号链接均拒绝，防止读取范围外内容", async t => {
  const root = await fixture(t);
  await rename(path.join(root, "app.js"), path.join(root, "app.js.backup"));
  await symlink("app.js.backup", path.join(root, "app.js"));
  await assert.rejects(() => collectPublicationFiles(root), /禁止符号链接：app.js/);
  await rm(path.join(root, "app.js"));
  await rename(path.join(root, "app.js.backup"), path.join(root, "app.js"));
  await rename(path.join(root, "scripts"), path.join(root, "private-scripts"));
  await symlink("private-scripts", path.join(root, "scripts"));
  await assert.rejects(() => collectPublicationFiles(root), /禁止符号链接：scripts\//);
  const wrapper = await mkdtemp(path.join(tmpdir(), "dashboard-publish-link-"));
  t.after(() => rm(wrapper, { recursive: true, force: true }));
  await symlink(root, path.join(wrapper, "site"));
  await assert.rejects(() => collectPublicationFiles(path.join(wrapper, "site")), /根目录必须为真实目录/);
});

test("发布入口在读取凭据与调用发布前完成清单校验，三方数据合并保持原样", async () => {
  const source = await readFile(new URL("../scripts/publish-github.mjs", import.meta.url), "utf8");
  const main = source.slice(source.indexOf("async function main()"));
  assert.ok(main.indexOf("collectPublicationFiles(ROOT)") < main.indexOf("readToken()"));
  assert.ok(main.indexOf("if (options.dryRun)") < main.indexOf("readToken()"));
  assert.match(source, /planPublication\(localFiles, remoteFiles, baseline\)/);
  assert.doesNotMatch(source, /async function collectFiles|readdir\(/);
});
