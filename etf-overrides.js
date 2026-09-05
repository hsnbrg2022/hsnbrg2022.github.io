import { upsertManualEtfFlow } from "./scripts/manual-etf-flow.mjs";

export const ETF_STORAGE_KEY = "crypto-signal-tracker:etf-edits-v2";
export const ETF_LEGACY_KEY = "crypto-signal-tracker:etf-flows-v1";
export const emptyEtfEdits = () => ({ schemaVersion: 2, edits: [], legacyReviewed: false });

export function validateEtfEdits(value) {
  if (value?.schemaVersion !== 2 || !Array.isArray(value.edits)) throw new Error("Invalid ETF browser edits");
  const dates = new Set();
  for (const edit of value.edits) {
    if (!Number.isFinite(edit.flowUsdMillions) || (edit.baseValue !== null && !Number.isFinite(edit.baseValue))) throw new Error("Invalid ETF browser edit value");
    upsertManualEtfFlow({ rows: [] }, edit);
    if (!Number.isFinite(Date.parse(edit.editedAt)) || dates.has(edit.date)) throw new Error("Invalid ETF browser edit date");
    dates.add(edit.date);
  }
  return value;
}

export function readEtfEdits(storage) {
  const raw = storage.getItem(ETF_STORAGE_KEY);
  return raw ? validateEtfEdits(JSON.parse(raw)) : emptyEtfEdits();
}

export function saveEtfEdit(state, published, input, now = new Date()) {
  const { dataset } = upsertManualEtfFlow({ rows: [] }, input, now);
  const row = dataset.rows[0];
  const previous = state.edits.find((edit) => edit.date === row.date);
  const edit = { ...row, sourceKey: input.sourceKey, editedAt: now.toISOString(),
    baseValue: previous ? previous.baseValue : published?.rows.find((item) => item.date === row.date)?.flowUsdMillions ?? null };
  return { ...state, edits: [...state.edits.filter((item) => item.date !== row.date), edit] };
}

// Never replace the whole published history with an old browser snapshot.
export function mergeEtfEdits(published, state = emptyEtfEdits()) {
  const rows = new Map(published.rows.map((row) => [row.date, { ...row }]));
  const conflicts = [];
  for (const edit of state.edits) {
    const official = rows.get(edit.date);
    if (official && official.flowUsdMillions !== edit.baseValue && official.flowUsdMillions !== edit.flowUsdMillions) conflicts.push(edit.date);
    rows.set(edit.date, { date: edit.date, flowUsdMillions: edit.flowUsdMillions, browserEditedAt: edit.editedAt, sourceKey: edit.sourceKey });
  }
  const mergedRows = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { ...published, rows: mergedRows, marketDate: mergedRows.at(-1)?.date,
    browserEditCount: state.edits.length, browserConflicts: conflicts };
}

// Legacy records are archived, not inferred as edits. Only explicit selections migrate.
export function migrateEtfSelection(state, published, legacy, dates, now = new Date()) {
  let next = state;
  for (const date of dates) {
    const row = legacy?.rows?.find((item) => item.date === date);
    if (!row) throw new Error("Legacy ETF record not found");
    next = saveEtfEdit(next, published, { ...row, sourceKey: /farside/i.test(legacy.source?.label || "") ? "farside" : "sosovalue" }, now);
  }
  return { ...next, legacyReviewed: true };
}
