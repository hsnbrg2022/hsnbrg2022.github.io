import { open, mkdir, lstat, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// Cooperative lock for the local server and publisher on the same machine.
// Never steal by age/PID: a suspended publisher may still own an in-flight write.
export async function withWriteLock(lockFile, run) {
  await mkdir(path.dirname(lockFile), { recursive: true });
  let handle;
  try { handle = await open(lockFile, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw Object.assign(new Error("正在发布或保存，本次未写入数据，请稍后重试。若上次操作异常退出，请先核查写入锁。"), { code: "DASHBOARD_WRITE_BUSY" });
  }
  const token = randomUUID();
  const identity = await handle.stat();
  let initialized = false;
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: new Date().toISOString() }));
    initialized = true;
    return await run();
  } finally {
    await handle.close();
    try {
      const current = await lstat(lockFile);
      if (current.dev !== identity.dev || current.ino !== identity.ino || current.isSymbolicLink()) throw new Error("锁归属已变化");
      if (initialized && JSON.parse(await readFile(lockFile, "utf8")).token !== token) throw new Error("锁归属已变化");
      await unlink(lockFile);
    } catch (error) {
      throw new Error("操作可能已完成，但写入锁未能安全释放；请核对数据及锁归属后重试。", { cause: error });
    }
  }
}
