import { tradingDaysSince, validTradingDate } from "./trading-calendar.js";
const FORMULA = "mstr_price_usd / net_btc_per_share_usd";
const METHODOLOGY_EFFECTIVE_DATE = "2026-07-23";

function card(data, id) {
  return data.cards.find((item) => item.id === id);
}

export function mnavBasisQuality(basisAsOf, mode, now = new Date(), complete = true) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  if (!validTradingDate(basisAsOf) || basisAsOf > today) return { state: "unknown", eligible: false, reason: "mnavBasisUnknown" };
  const ageDays = (Date.parse(today) - Date.parse(basisAsOf)) / 86400000;
  if (ageDays > 7) return { state: "stale", eligible: false, reason: "mnavBasisStale" };
  if (complete === false) return { state: "unknown", eligible: false, reason: "mnavBasisIncomplete" };
  // No current adapter verifies every convertible instrument. A label, price
  // deviation or aggregate debt balance is not evidence of classification.
  if (mode !== "official-live") return { state: "unknown", eligible: false, reason: "mnavClassificationUnknown" };
  return { state: "fresh", eligible: true };
}

// Dates here come from disclosures, independently of either market timestamp.
export function assessStrategyCapital(evidence, mstrPriceUsd, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const nonNegative = value => Number.isFinite(value) && value >= 0;
  const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
  const dated = (item, sourcePattern) => validTradingDate(item?.asOf) && item.asOf <= today
    && typeof item.source === "string" && sourcePattern.test(item.source);
  const { filing, shares, claims } = evidence ?? {};
  if (!dated(filing, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1050446\/\d+\/mstr-\d{8}\.htm$/)
    || !positiveInteger(filing.btcHoldings) || !nonNegative(filing.usdReserve) || !nonNegative(filing.usdCash)
    || !Number.isFinite(filing.usdReserve + filing.usdCash)) {
    return { asOf: null, reason: "mnavCapitalSourceMissing" };
  }
  const { asOf } = filing;
  if (!dated(shares, /^https:\/\/www\.strategy\.com\/shares$/)
    || !positiveInteger(shares.fullyDilutedShares) || !positiveInteger(shares.btcHoldings)) {
    return { asOf, reason: "mnavCapitalSharesMissing" };
  }
  if (shares.asOf !== asOf || shares.btcHoldings !== filing.btcHoldings) {
    return { asOf, reason: "mnavCapitalMismatch" };
  }
  if (!dated(claims, /^https:\/\/(?:www\.strategy\.com\/(?:debt|credit\/risk|press\/[a-zA-Z0-9_-]+)|www\.sec\.gov\/Archives\/edgar\/data\/1050446\/\d+\/[a-zA-Z0-9_.-]+\.htm)$/)) {
    return { asOf, reason: "mnavCapitalClaimsMissing" };
  }
  if (claims.asOf !== asOf) return { asOf, reason: "mnavCapitalMismatch" };
  const instruments = claims.instruments;
  if (!Array.isArray(instruments) || !instruments.some(row => row?.kind === "debt")
    || !instruments.some(row => row?.kind === "preferred")
    || instruments.some(row => typeof row?.security !== "string" || !row.security
      || !["debt", "preferred"].includes(row.kind) || !nonNegative(row.notionalUsd)
      || (row.conversionPriceUsd !== null && !(Number.isFinite(row.conversionPriceUsd) && row.conversionPriceUsd > 0)))
    || new Set(instruments.map(row => row.security)).size !== instruments.length
    || !nonNegative(claims.totalDebtUsd) || !nonNegative(claims.totalPreferredUsd)
    || instruments.filter(row => row.kind === "debt").reduce((sum, row) => sum + row.notionalUsd, 0) !== claims.totalDebtUsd
    || instruments.filter(row => row.kind === "preferred").reduce((sum, row) => sum + row.notionalUsd, 0) !== claims.totalPreferredUsd) {
    return { asOf, reason: "mnavCapitalClaimsMissing" };
  }
  const conversions = instruments.filter(row => row.conversionPriceUsd !== null);
  const included = shares.includedConversions;
  if (!Array.isArray(included) || new Set(included).size !== included.length
    || !positiveInteger(shares.basicShares)
    || ![shares.optionsShares, shares.awardShares].every(value => Number.isSafeInteger(value) && value >= 0)
    || !included.every(security => conversions.some(row => row.security === security))
    || !(Number.isFinite(mstrPriceUsd) && mstrPriceUsd > 0)
    || conversions.some(row => included.includes(row.security) !== (mstrPriceUsd >= row.conversionPriceUsd))
    || conversions.some(row => included.includes(row.security) && !positiveInteger(row.conversionShares))
    || shares.basicShares + shares.optionsShares + shares.awardShares
      + conversions.filter(row => included.includes(row.security)).reduce((sum, row) => sum + row.conversionShares, 0)
      !== shares.fullyDilutedShares) {
    return { asOf, reason: "mnavCapitalConversionMissing" };
  }
  return { asOf, basis: {
    asOf, btcHoldings: filing.btcHoldings, usdAssetsUsd: filing.usdReserve + filing.usdCash,
    seniorClaimsUsd: instruments.filter(row => !included.includes(row.security)).reduce((sum, row) => sum + row.notionalUsd, 0),
    fullyDilutedShares: shares.fullyDilutedShares,
    classification: "Official disclosed instruments and FDSO reconciled"
  } };
}

export function withStrategyCapital(dataset, evidence, now = new Date()) {
  const price = dataset.inputs?.mstrPriceUsd;
  const next = assessStrategyCapital(evidence, price, now);
  const prior = assessStrategyCapital(dataset.capitalEvidence, price, now);
  if (prior.asOf && (!next.asOf || prior.asOf > next.asOf || (prior.asOf === next.asOf && prior.basis && !next.basis))) {
    evidence = dataset.capitalEvidence;
  }
  const capital = assessStrategyCapital(evidence, price, now);
  const basis = capital.basis && capital.asOf >= (dataset.basisAsOf ?? "") ? capital.basis : dataset.basis;
  return {
    ...dataset,
    basis,
    basisAsOf: basis?.asOf || dataset.basisAsOf || null,
    basisComplete: Boolean(capital.basis && basis === capital.basis),
    ...(evidence ? { capitalEvidence: evidence } : {})
  };
}

function positiveNumber(value, label, { min = 0, max = Infinity } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= min || number > max) throw new Error(`${label} 无效`);
  return number;
}

function money(value, digits = 2) {
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function validateStrategyMnavDataset(dataset, { now = new Date() } = {}) {
  if (dataset?.schemaVersion !== 1 || dataset.status !== "active") throw new Error("Strategy mNAV 自动快照尚未启用");
  if (dataset.formula !== FORMULA || dataset.methodologyEffectiveDate !== METHODOLOGY_EFFECTIVE_DATE) {
    throw new Error("Strategy mNAV 快照不是 2026-07-23 起的新口径");
  }
  const captured = Date.parse(dataset.generatedAt);
  if (typeof dataset.generatedAt !== "string" || !dataset.generatedAt.endsWith("Z") || !Number.isFinite(captured) || captured > now.getTime()) throw new Error("Strategy mNAV 快照时间无效");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  if (!validTradingDate(dataset.marketAsOf) || dataset.marketAsOf > today) throw new Error("Strategy mNAV 行情日期无效");
  // Official readings may be displayed independently of capital-basis eligibility.
  // Estimates are still forbidden, even when their aggregate basis looks fresh.
  if (dataset.calculation?.mode !== "official-live") throw new Error("Strategy mNAV: mnavClassificationUnknown");
  const mnav = positiveNumber(dataset.mnav, "Strategy mNAV", { min: 0.2, max: 10 });
  const mstrPriceUsd = positiveNumber(dataset.inputs?.mstrPriceUsd, "MSTR 股价", { min: 1, max: 10_000 });
  const btcPriceUsd = positiveNumber(dataset.inputs?.btcPriceUsd, "BTC 价格", { min: 1_000, max: 10_000_000 });
  const netBtcPerShareUsd = positiveNumber(dataset.inputs?.netBtcPerShareUsd, "Net BTC Per Share ($)", { min: 1, max: 10_000 });
  const capital = dataset.capitalEvidence ? assessStrategyCapital(dataset.capitalEvidence, mstrPriceUsd, now) : null;
  let basisQuality = mnavBasisQuality(dataset.basisAsOf, dataset.calculation.mode, now, dataset.basisComplete);
  if (capital) {
    if (capital.reason) basisQuality = { state: "unknown", eligible: false, reason: capital.reason };
    else if (dataset.basisComplete !== true || dataset.basisAsOf !== capital.asOf
      || Object.entries(capital.basis).some(([key, value]) => dataset.basis?.[key] !== value)) {
      basisQuality = { state: "unknown", eligible: false, reason: "mnavCapitalMismatch" };
    }
  }
  const expectedMnav = mstrPriceUsd / netBtcPerShareUsd;
  if (Math.abs(expectedMnav - mnav) > 0.03) throw new Error("Strategy mNAV 公式校验失败");

  const ageBusinessDays = tradingDaysSince(dataset.marketAsOf, now);
  if (ageBusinessDays > 2) throw new Error(`Strategy mNAV 行情已滞后 ${ageBusinessDays} 个交易日`);
  return { mnav, mstrPriceUsd, btcPriceUsd, netBtcPerShareUsd, ageBusinessDays, basisQuality, capital };
}

export function applyStrategyMnavDataset(data, dataset, { now = new Date() } = {}) {
  const values = validateStrategyMnavDataset(dataset, { now });
  const target = card(data, 2);
  if (!target) throw new Error("Strategy mNAV 卡片未找到");
  const netBtc = Number(dataset.inputs?.netBtc);

  target.title = "Strategy mNAV";
  target.headline = `${values.mnav.toFixed(2)}x · MSTR $${money(values.mstrPriceUsd)}`;
  target.facts = [
    `Net BPS $${money(values.netBtcPerShareUsd)}`,
    Number.isFinite(netBtc) && netBtc > 0
      ? `净 BTC ${Math.round(netBtc).toLocaleString("en-US")}`
      : `BTC $${money(values.btcPriceUsd, 0)}`,
    ...(values.capital ? [`官方行情日期 ${dataset.marketAsOf}`] : []),
    ...(values.capital?.reason && values.capital.asOf
      ? [`已核实部分资本资料日期 ${values.capital.asOf}`]
      : [validTradingDate(dataset.basisAsOf) ? `资本资料日期 ${dataset.basisAsOf}` : "资本资料日期待核验"]),
    ...(!values.capital && !values.basisQuality.eligible ? ["资本资料未确认 · 不计入当期确认"] : [])
  ];
  target.detail = "采用 Strategy 2026-07-23 起最新口径：MSTR 股价 ÷ Net BTC Per Share ($)；数值来自官方看板。";
  target.status = values.mnav >= 1 ? "green" : values.mnav >= 0.9 ? "yellow" : "red";
  target.change = `mNAV ${values.mnav.toFixed(2)}x · 最新口径`;
  target.source = {
    label: "Strategy 官方看板",
    url: dataset.source?.url || "https://www.strategy.com/btc"
  };
  target.refresh = "auto";
  target.refreshStatus = "ok";
  target.refreshMessage = `mNAV / ${target.source.label} · 行情截至 ${dataset.marketAsOf}`;
  target.refreshMethod = "scheduled-snapshot";
  target.dataAsOf = dataset.marketAsOf;
  target.basisAsOf = dataset.basisAsOf;
  target.mnavBasisComplete = values.capital ? values.basisQuality.eligible : dataset.basisComplete;
  target.mnavCapital = values.capital ? { asOf: values.capital.asOf, reason: values.basisQuality.reason ?? null } : null;
  target.mnavMode = dataset.calculation.mode;
  target.marketFetchedAt = dataset.generatedAt;
  target.mnavSnapshotAt = dataset.generatedAt;
  target.lastRefreshAt = dataset.generatedAt;
  if (Array.isArray(data.previous?.changes)) {
    const line = `② mNAV：${target.change}，${target.detail}`;
    const index = data.previous.changes.findIndex((item) => item.startsWith("② mNAV："));
    if (index >= 0) data.previous.changes[index] = line;
    else data.previous.changes.push(line);
  }
  return target.refreshMessage;
}

export async function updateMnavFromSnapshot(data, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const healthRead = readMnavHealth(data, fetchImpl, controller.signal);
  const capitalRead = Promise.resolve().then(() => fetchImpl(`./strategy-mnav-capital.json?v=${Date.now()}`, {
    cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal
  })).then(response => response.ok ? response.json() : null).catch(() => null);
  try {
    const paths = ["https://raw.githubusercontent.com/hsnbrg2022/hsnbrg2022.github.io/main/strategy-mnav.json", "./strategy-mnav.json"];
    const candidates = await Promise.allSettled(paths.map(async path => {
      const response = await fetchImpl(`${path}?v=${Date.now()}`, {
        cache: "no-store", headers: { accept: "application/json" }, signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const dataset = await response.json();
      validateStrategyMnavDataset(dataset);
      return dataset;
    }));
    const valid = candidates.filter(item => item.status === "fulfilled").map(item => item.value)
      .sort((a, b) => b.marketAsOf.localeCompare(a.marketAsOf) || String(b.generatedAt).localeCompare(String(a.generatedAt)));
    if (!valid.length) throw candidates[0].reason;
    const evidence = await capitalRead;
    const selected = evidence?.filing ? withStrategyCapital(valid[0], evidence) : valid[0];
    const result = applyStrategyMnavDataset(data, selected);
    card(data, 2).mnavReadCheck = { checkedAt: new Date().toISOString(), status: "ok" };
    return result;
  } catch (error) {
    const target = card(data, 2);
    if (target) target.mnavReadCheck = { checkedAt: new Date().toISOString(), status: "failed", message: String(error.message || error) };
    throw error;
  } finally {
    await Promise.all([healthRead, capitalRead]);
    clearTimeout(timer);
  }
}

const HEALTH_ERRORS = {
  upstream_request_failed: "healthUpstreamFailed",
  invalid_official_quote: "healthQuoteInvalid",
  validation_failed: "healthValidationFailed",
  collector_failed: "healthCollectorFailed"
};

export function validateMnavHealth(value, { now = new Date() } = {}) {
  const invalid = () => { throw new Error("Invalid mNAV collection record"); };
  const time = stamp => typeof stamp === "string" && Number.isFinite(Date.parse(stamp))
    && new Date(stamp).toISOString() === stamp && Date.parse(stamp) <= now.getTime();
  if (value?.schemaVersion !== 1 || value.collector !== "strategy-mnav") return invalid();
  if (value.status === "unknown") {
    if ([value.execution, value.checkedAt, value.lastSuccessAt, value.snapshotChanged, value.errorCode].some(v => v !== null)) return invalid();
  } else {
    if (!["ok", "failed"].includes(value.status) || !["local", "github-actions"].includes(value.execution) || !time(value.checkedAt)) return invalid();
    if (value.lastSuccessAt !== null && (!time(value.lastSuccessAt) || value.lastSuccessAt > value.checkedAt)) return invalid();
    if (value.status === "ok" ? value.lastSuccessAt !== value.checkedAt || typeof value.snapshotChanged !== "boolean" || value.errorCode !== null
      : value.snapshotChanged !== null || !Object.hasOwn(HEALTH_ERRORS, value.errorCode)) return invalid();
  }
  // Select only known fields. Never render a remote exception message or payload.
  return Object.fromEntries(["schemaVersion", "collector", "execution", "status", "checkedAt", "lastSuccessAt", "snapshotChanged", "errorCode"].map(key => [key, value[key]]));
}

async function readMnavHealth(data, fetchImpl, signal) {
  const paths = ["https://raw.githubusercontent.com/hsnbrg2022/hsnbrg2022.github.io/main/strategy-mnav-health.json", "./strategy-mnav-health.json"];
  const results = await Promise.allSettled(paths.map(async path => {
    const response = await fetchImpl(`${path}?v=${Date.now()}`, { cache: "no-store", headers: { accept: "application/json" }, signal });
    if (!response.ok) throw new Error("Collection record unavailable");
    return validateMnavHealth(await response.json());
  }));
  const valid = results.filter(r => r.status === "fulfilled").map(r => r.value)
    .sort((a, b) => String(b.checkedAt ?? "").localeCompare(String(a.checkedAt ?? "")));
  const target = card(data, 2);
  if (target) target.mnavBackendHealth = valid[0] ?? null;
}

// Reading a published snapshot cannot establish when its collector last ran.
export function mnavHealthRows(target) {
  const time = value => {
    const ms = typeof value === "string" && value.endsWith("Z") ? Date.parse(value) : NaN;
    return Number.isFinite(ms) ? new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
    }).format(new Date(ms)) : null;
  };
  const check = target.mnavReadCheck;
  let backend;
  try { backend = validateMnavHealth(target.mnavBackendHealth); } catch { /* Unknown is not a successful check. */ }
  const recorded = backend && backend.status !== "unknown";
  return [
    ["healthMode", null, target.refreshMethod === "scheduled-snapshot" ? "healthSnapshotMode" : "healthUnknown"],
    ["healthMarketDate", validTradingDate(target.dataAsOf) ? target.dataAsOf : null],
    ["healthSnapshotCreated", time(target.mnavSnapshotAt)],
    ["healthReadCheck", time(check?.checkedAt)],
    ["healthReadStatus", null, check?.status === "ok" ? "healthReadOk" : check?.status === "failed" ? "healthReadFailed" : "healthUnknown"],
    ...(check?.status === "failed" ? [["healthReadError", check.message || null]] : []),
    ["healthBackendExecution", null, recorded ? (backend.execution === "github-actions" ? "healthCloud" : "healthLocal") : "healthUnknown"],
    ["healthBackendCheck", time(backend?.checkedAt)],
    ["healthBackendSuccess", time(backend?.lastSuccessAt)],
    ["healthBackendStatus", null, !recorded ? "healthUnknown" : backend.status === "failed" ? "healthCollectionFailed" : backend.snapshotChanged ? "healthCollected" : "healthUnchanged"],
    ["healthBackendError", null, !recorded ? "healthUnknown" : backend.status === "ok" ? "healthNoError" : HEALTH_ERRORS[backend.errorCode]]
  ];
}

export const STRATEGY_MNAV_FORMULA = FORMULA;
export const STRATEGY_MNAV_METHODOLOGY_EFFECTIVE_DATE = METHODOLOGY_EFFECTIVE_DATE;
export const strategyMnavBusinessDaysSince = tradingDaysSince;
