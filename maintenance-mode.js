// Capability detection is not authentication. Never probe a remote website or
// infer a writable backend merely from a loopback hostname.
export async function detectLocalMaintenance(location, fetchImpl = globalThis.fetch, { timeoutMs = 2000 } = {}) {
  if (location?.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(location.hostname)) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl("/api/capabilities", {
      cache: "no-store", redirect: "error", headers: { accept: "application/json" }, signal: controller.signal
    });
    if (!response.ok) return false;
    const value = await response.json();
    return !controller.signal.aborted && value?.schemaVersion === 1 && value.service === "crypto-dashboard-tracker"
      && value.requestProtection === "same-origin-json-v1"
      && ["etf", "positioning", "refresh", "snapshot"].every(key => value.maintenance?.[key] === true);
  } catch { return false; }
  finally { clearTimeout(timer); }
}
