import { assessMarket, btcObservationTimestamp } from "./data-quality.js?v=20260911-2";

export const DAILY_BASELINE_KEY = "crypto-signal-tracker:daily-baselines-v1";
const DAY = 86400000;
const FIELDS = ["btcPrice", "btcCurrency", "btcObservedAt", "btcSource", "fng", "fngFetchedAt", "fngSource"];

export function beijingDay(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}

function readRows(storage, now) {
  const raw = storage.getItem(DAILY_BASELINE_KEY);
  if (raw == null) return [];
  const value = JSON.parse(raw);
  if (value?.version !== 1 || !Array.isArray(value.rows)) throw new Error("Invalid daily history");
  return value.rows.filter(row => {
    const time = btcObservationTimestamp(row?.savedAt);
    return Number.isFinite(time) && time <= now.getTime() && now.getTime() - time <= 7 * DAY
      && row.day === beijingDay(new Date(time)) && row.market && typeof row.market === "object";
  });
}

// Only completed refreshes call this. Merely opening, rendering or editing never
// turns the published snapshot into a newly observed daily baseline.
export function saveDailyBaseline(storage, data, now = new Date()) {
  const rows = readRows(storage, now);
  const day = beijingDay(now);
  const market = Object.fromEntries(FIELDS.filter(key => data.market?.[key] !== undefined).map(key => [key, data.market[key]]));
  const row = { day, savedAt: now.toISOString(), market };
  const next = [...rows.filter(item => item.day !== day), row]
    .sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt)).slice(-7);
  storage.setItem(DAILY_BASELINE_KEY, JSON.stringify({ version: 1, rows: next }));
}

export function dailyBaselineView(data, storage, now = new Date()) {
  const today = beijingDay(now);
  const yesterday = beijingDay(new Date(now.getTime() - DAY));
  let row, status = "missing";
  try {
    row = readRows(storage, now).filter(item => item.day === yesterday)
      .sort((a, b) => Date.parse(a.savedAt) - Date.parse(b.savedAt)).at(-1);
    if (row) status = "available";
  } catch { status = "unavailable"; }
  // Historical validity is assessed at capture time, current validity at view
  // time by the existing model. A valid yesterday quote need not be 15 min old now.
  const quality = row ? assessMarket(row.market, new Date(row.savedAt)) : null;
  const previous = {
    baselineStatus: status, today, date: row ? yesterday : null, capturedAt: row?.savedAt || null,
    ...(quality?.btc.eligible ? { btcPrice: row.market.btcPrice, btcCurrency: row.market.btcCurrency } : {}),
    ...(quality?.fng.eligible ? { fng: row.market.fng } : {})
  };
  return { ...data, previous };
}
