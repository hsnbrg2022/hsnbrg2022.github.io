import { validTradingDate, isTradingDay } from "./trading-calendar.js";

const ERRORS = { upstream_unavailable: "etfHealthUpstreamFailed", validation_failed: "healthValidationFailed", collector_failed: "healthCollectorFailed" };

export function validateEtfHealth(value, { now = new Date() } = {}) {
  const invalid = () => { throw new Error("Invalid ETF collection record"); };
  const time = stamp => typeof stamp === "string" && Number.isFinite(Date.parse(stamp))
    && new Date(stamp).toISOString() === stamp && Date.parse(stamp) <= +now;
  if (value?.schemaVersion !== 1 || value.collector !== "etf-flows") return invalid();
  if (value.status === "unknown") {
    if ([value.execution, value.checkedAt, value.lastSuccessAt, value.snapshotChanged, value.errorCode].some(v => v !== null)) return invalid();
  } else {
    if (!["ok", "failed"].includes(value.status) || !["local", "github-actions"].includes(value.execution) || !time(value.checkedAt)) return invalid();
    if (value.lastSuccessAt !== null && (!time(value.lastSuccessAt) || value.lastSuccessAt > value.checkedAt)) return invalid();
    if (value.status === "ok" ? value.lastSuccessAt !== value.checkedAt || typeof value.snapshotChanged !== "boolean" || value.errorCode !== null
      : value.snapshotChanged !== null || !Object.hasOwn(ERRORS, value.errorCode)) return invalid();
  }
  let completeness = null;
  if (value.completeness != null) {
    const c = value.completeness;
    if (value.status !== "ok" || !["complete", "missing-trading-days", "calendar-unverified"].includes(c.status)
      || !Array.isArray(c.missingDates) || c.missingDates.length > 1000
      || c.missingDates.some((d, i) => !validTradingDate(d) || isTradingDay(d) !== true || d > value.checkedAt.slice(0, 10) || i > 0 && d <= c.missingDates[i - 1])
      || c.status === "complete" && c.missingDates.length !== 0
      || c.status === "missing-trading-days" && c.missingDates.length === 0) return invalid();
    completeness = { status: c.status, missingDates: [...c.missingDates] };
  }
  // Never expose unknown remote fields, URLs, credentials or exception text.
  return { ...Object.fromEntries(["schemaVersion", "collector", "execution", "status", "checkedAt", "lastSuccessAt", "snapshotChanged", "errorCode"].map(k => [k, value[k]])), completeness };
}

export async function readEtfHealth(data, fetchImpl = globalThis.fetch) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const paths = ["https://raw.githubusercontent.com/hsnbrg2022/hsnbrg2022.github.io/main/etf-flows-health.json", "./etf-flows-health.json"];
    const results = await Promise.allSettled(paths.map(async path => {
      const response = await fetchImpl(`${path}?v=${Date.now()}`, { cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal });
      if (!response.ok) throw new Error("ETF record unavailable");
      return validateEtfHealth(await response.json());
    }));
    const valid = results.filter(r => r.status === "fulfilled").map(r => r.value)
      .sort((a, b) => String(b.checkedAt ?? "").localeCompare(String(a.checkedAt ?? "")));
    const target = data.cards.find(c => c.id === 1);
    if (target) target.etfBackendHealth = valid[0] ?? null;
  } finally { clearTimeout(timer); }
}

export function etfHealthRows(target) {
  const time = value => {
    const ms = typeof value === "string" && value.endsWith("Z") ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date(ms)) : null;
  };
  let backend;
  try { backend = validateEtfHealth(target.etfBackendHealth); } catch { /* Missing/invalid is unknown, not success. */ }
  const recorded = backend && backend.status !== "unknown", check = target.etfReadCheck;
  const coverage = recorded ? backend.completeness : null;
  return [
    ["healthMode", null, target.etfSnapshotAt ? "healthSnapshotMode" : "healthUnknown"],
    ["etfHealthMarketDate", validTradingDate(target.dataAsOf) ? target.dataAsOf : null],
    ["healthSnapshotCreated", time(target.etfSnapshotAt)],
    ["healthReadCheck", time(check?.checkedAt)],
    ["healthReadStatus", null, check?.status === "ok" ? "healthReadOk" : check?.status === "failed" ? "etfHealthReadFailed" : "healthUnknown"],
    ["healthBackendExecution", null, recorded ? backend.execution === "github-actions" ? "healthCloud" : "healthLocal" : "healthUnknown"],
    ["healthBackendCheck", time(backend?.checkedAt)],
    ["healthBackendSuccess", time(backend?.lastSuccessAt)],
    ["healthBackendStatus", null, !recorded ? "healthUnknown" : backend.status === "failed" ? "etfHealthCollectionFailed" : backend.snapshotChanged ? "healthCollected" : "etfHealthUnchanged"],
    ["healthBackendError", null, !recorded ? "healthUnknown" : backend.status === "ok" ? "healthNoError" : ERRORS[backend.errorCode]],
    ["etfHealthCompleteness", null, coverage?.status === "complete" ? "etfHealthComplete" : coverage?.status === "missing-trading-days" ? "etfHealthMissing" : "healthUnknown"],
    ...(coverage?.missingDates.length ? [["etfHealthMissingDates", coverage.missingDates.join(", ")]] : [])
  ];
}
