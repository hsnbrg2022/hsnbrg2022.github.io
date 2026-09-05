import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { applyEtfDataset } from "./update-etf-flows.mjs";

export const PROTECTED_DATA_FILES = new Set([
  "dashboard.json", "etf-flows.json", "fed-signals.json", "true-market-mean.json", "strategy-mnav.json"
]);

export function gitBlobSha(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  return createHash("sha1").update(Buffer.from(`blob ${buffer.length}\0`)).update(buffer).digest("hex");
}

const same = isDeepStrictEqual;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const date = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;

function conflict(location) {
  throw new Error(`${location}：本地与 GitHub 都有不同修改，无法安全合并；已停止发布，请核对该项（原文件未改动）`);
}

function observationDates(value) {
  if (!object(value)) return [];
  return [value.marketDate, value.marketAsOf, value.basisAsOf, value.asOf, value.dataAsOf,
    value.fomc?.eventDate, value.chair?.eventDate].filter((item) => date(item) !== null);
}

// Used only for the first synchronization. Both observation dates and capture time
// must establish one direction; a newly edited old observation is not discarded.
function bootstrapObservation(local, remote, location) {
  const localDates = observationDates(local);
  const remoteDates = observationDates(remote);
  const localCaptured = date(local?.generatedAt ?? local?.marketFetchedAt ?? local?.lastRefreshAt);
  const remoteCaptured = date(remote?.generatedAt ?? remote?.marketFetchedAt ?? remote?.lastRefreshAt);
  if (localDates.length !== remoteDates.length || localCaptured === null || remoteCaptured === null) {
    return conflict(`${location}（首次同步缺少可比较的日期）`);
  }
  const comparisons = localDates.map((item, index) => date(item) - date(remoteDates[index]));
  comparisons.push(localCaptured - remoteCaptured);
  if (comparisons.every((item) => item >= 0) && comparisons.some((item) => item > 0)) return local;
  if (comparisons.every((item) => item <= 0) && comparisons.some((item) => item < 0)) return remote;
  return conflict(`${location}（首次同步不能判定修改先后）`);
}

function mergeAtomic(base, local, remote, location, hasBase, bootstrap = false) {
  if (same(local, remote)) return local;
  if (hasBase && same(local, base)) return remote;
  if (hasBase && same(remote, base)) return local;
  if (!hasBase && bootstrap && local !== undefined && remote !== undefined) {
    return bootstrapObservation(local, remote, location);
  }
  return conflict(location);
}

function mergeKeyedArray(base, local, remote, key, location, hasBase, bootstrap = false) {
  if (!Array.isArray(local) || !Array.isArray(remote)) return conflict(location);
  const index = (rows) => {
    const result = new Map();
    for (const row of rows ?? []) {
      const id = row?.[key];
      if (id === undefined || result.has(id)) return conflict(`${location}（缺少或重复 ${key}）`);
      result.set(id, row);
    }
    return result;
  };
  const b = index(base), l = index(local), r = index(remote);
  const keys = new Set([...r.keys(), ...l.keys(), ...b.keys()]);
  return [...keys].map((id) => {
    // With a baseline, adding a new date/card on only one side is unambiguous.
    if (hasBase && !b.has(id) && (!l.has(id) || !r.has(id))) return l.get(id) ?? r.get(id);
    return mergeAtomic(b.get(id), l.get(id), r.get(id), `${location}[${id}]`, hasBase, bootstrap);
  }).filter((value) => value !== undefined);
}

function mergeChangeLines(base, local, remote, location, hasBase, context) {
  const wrap = (lines) => (lines ?? []).map((value) => ({ id: value.match(/^[①②③④⑤⑥⑦⑧⑨]|^BTC\b/)?.[0] ?? value, value }));
  if (hasBase) return mergeKeyedArray(wrap(base), wrap(local), wrap(remote), "id", location, true).map((row) => row.value);
  const l = new Map(wrap(local).map((row) => [row.id, row.value]));
  const r = new Map(wrap(remote).map((row) => [row.id, row.value]));
  return [...new Set([...r.keys(), ...l.keys()])].map((id) => {
    if (l.get(id) === r.get(id)) return l.get(id);
    const cardId = "①②③④⑤⑥⑦⑧⑨".indexOf(id) + 1;
    const localCard = context.local.cards?.find((card) => card.id === cardId);
    const remoteCard = context.remote.cards?.find((card) => card.id === cardId);
    if (!localCard || !remoteCard || same(localCard, remoteCard)) return conflict(`${location}[${id}]`);
    const chosen = bootstrapObservation(localCard, remoteCard, `${location}[${id}]`);
    return chosen === localCard ? l.get(id) : r.get(id);
  }).filter((line) => line !== undefined);
}

function mergeObject(base, local, remote, location, hasBase, context = { local, remote }) {
  if (same(local, remote)) return local;
  if (hasBase && same(local, base)) return remote;
  if (hasBase && same(remote, base)) return local;
  if (!object(local) || !object(remote)) return conflict(location);
  const result = {};
  for (const key of new Set([...Object.keys(remote), ...Object.keys(local), ...Object.keys(base ?? {})])) {
    const b = base?.[key], l = local[key], r = remote[key];
    let value;
    if (same(l, r)) value = l;
    else if (hasBase && same(l, b)) value = r;
    else if (hasBase && same(r, b)) value = l;
    else if (["updatedAt", "generatedAt", "date", "marketDate"].includes(key) && date(l) !== null && date(r) !== null) {
      value = date(l) >= date(r) ? l : r;
    } else if (key === "cards") value = mergeKeyedArray(b, l, r, "id", `${location}.cards`, hasBase, true);
    else if (key === "changes" && Array.isArray(l) && Array.isArray(r)) value = mergeChangeLines(b, l, r, `${location}.changes`, hasBase, context);
    else if (key === "trueMarketMean") value = mergeAtomic(b, l, r, `${location}.${key}`, hasBase, true);
    else if (object(l) && object(r)) value = mergeObject(b, l, r, `${location}.${key}`, hasBase, context);
    else value = conflict(`${location}.${key}`);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function assertNoRegression(candidate, remote, location) {
  if (!object(remote)) return;
  if (!object(candidate)) throw new Error(`${location}：禁止发布时丢失已有观测`);
  for (const key of ["marketDate", "marketAsOf", "basisAsOf", "asOf", "dataAsOf", "eventDate"]) {
    if (date(remote[key]) !== null && (date(candidate[key]) === null || date(candidate[key]) < date(remote[key]))) {
      throw new Error(`${location}.${key}：禁止把 GitHub 的 ${remote[key]} 回退到 ${candidate[key] ?? "无日期"}`);
    }
  }
  for (const key of ["fomc", "chair", "trueMarketMean"]) assertNoRegression(candidate[key], remote[key], `${location}.${key}`);
  if (Array.isArray(remote.cards)) {
    for (const card of remote.cards) {
      const next = candidate.cards?.find((item) => item.id === card.id);
      if (!next) throw new Error(`${location}.cards[${card.id}]：禁止发布时丢失已有卡片`);
      assertNoRegression(next, card, `${location}.cards[${card.id}]`);
    }
  }
  if (Array.isArray(remote.rows)) {
    const dates = new Set(candidate.rows?.map((row) => row.date));
    if (remote.rows.some((row) => !dates.has(row.date))) {
      throw new Error(`${location}.rows：禁止发布时丢失 GitHub 已有交易日`);
    }
  }
}

export function mergeProtectedData(file, baseContent, localContent, remoteContent) {
  const parse = (content) => JSON.parse(Buffer.isBuffer(content) ? content.toString("utf8") : content);
  const local = parse(localContent), remote = parse(remoteContent);
  const hasBase = baseContent !== undefined;
  const base = hasBase ? parse(baseContent) : undefined;
  let merged;
  if (same(local, remote)) return Buffer.from(remoteContent);
  if (hasBase && same(local, base)) return Buffer.from(remoteContent);
  if (file === "dashboard.json") {
    merged = mergeObject(base, local, remote, file, hasBase);
  } else if (file === "etf-flows.json" && hasBase) {
    const rows = mergeKeyedArray(base?.rows, local.rows, remote.rows, "date", `${file}.rows`, true)
      .sort((left, right) => left.date.localeCompare(right.date));
    const withoutRows = (value) => { const { rows: ignored, ...rest } = value; return rest; };
    merged = { ...mergeObject(withoutRows(base), withoutRows(local), withoutRows(remote), file, true), rows };
    merged.marketDate = rows.at(-1)?.date;
  } else {
    merged = mergeAtomic(base, local, remote, file, hasBase, true);
  }
  assertNoRegression(merged, remote, file);
  if (same(merged, local)) return Buffer.from(localContent);
  if (same(merged, remote)) return Buffer.from(remoteContent);
  return Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
}

export function planPublication(localFiles, remoteFiles, baseline = null) {
  const result = [];
  // Merge the ETF records before their derived dashboard card. This lets a local
  // correction coexist with a newer remote trading day without mixing totals.
  const orderedFiles = [...localFiles].sort((a, b) => Number(a.relativePath === "dashboard.json") - Number(b.relativePath === "dashboard.json"));
  for (const local of orderedFiles) {
    const remote = remoteFiles.get(local.relativePath);
    const baseSha = baseline?.files?.[local.relativePath];
    let content = local.content;
    const etf = result.find((file) => file.relativePath === "etf-flows.json");
    const etfChanged = etf && (etf.sha !== etf.originalSha || etf.sha !== remoteFiles.get("etf-flows.json")?.sha);
    if (remote && (remote.sha !== local.sha || local.relativePath === "dashboard.json" && etfChanged)) {
      if (PROTECTED_DATA_FILES.has(local.relativePath)) {
        let baseContent = baseline?.data?.[local.relativePath];
        let localContent = local.content, remoteContent = remote.content;
        if (local.relativePath === "dashboard.json" && etf) {
          const dataset = JSON.parse(etf.content);
          const alignEtf = (input) => {
            if (input === undefined) return undefined;
            const dashboard = JSON.parse(input);
            if (!dashboard.cards?.some((card) => card.id === 1)) return input;
            applyEtfDataset(dashboard, dataset);
            const card = dashboard.cards.find((card) => card.id === 1);
            if (card.manualEntry) {
              card.refreshStatus = "snapshot";
              card.refreshMessage = `ETF / ${dataset.source.label} · 手工维护 · 截至 ${dataset.marketDate}`;
            }
            if (Array.isArray(dashboard.previous?.changes)) {
              const index = dashboard.previous.changes.findIndex((line) => line.startsWith("① ETF："));
              if (index >= 0) dashboard.previous.changes[index] = `① ETF：${card.headline}`;
            }
            return Buffer.from(`${JSON.stringify(dashboard, null, 2)}\n`);
          };
          baseContent = alignEtf(baseContent);
          localContent = alignEtf(localContent);
          remoteContent = alignEtf(remoteContent);
        }
        content = mergeProtectedData(local.relativePath, baseContent, localContent, remoteContent);
      } else if (baseSha && local.sha === baseSha) {
        content = remote.content;
      } else if (baseSha && remote.sha !== baseSha) {
        conflict(local.relativePath);
      }
    } else if (!remote && baseSha) {
      conflict(`${local.relativePath}（GitHub 已删除该文件）`);
    }
    result.push({ ...local, content, sha: gitBlobSha(content), originalSha: local.sha });
  }
  return result;
}
