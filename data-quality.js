import { tradingDaysSince } from "./trading-calendar.js";
import { mnavBasisQuality } from "./mnav-source.js?v=20260906-4";
import { ONCHAIN, onchainAgeDays } from "./onchain-source.js?v=20260906-5";
import { stablecoinQuality } from "./stablecoin-source.js?v=20260909-1";
const DAY = 86400000;

// Header readings are independent of the nine signal-card scoring rules.
export function assessMarket(market = {}, now = new Date()) {
  return Object.fromEntries([
    ["btc", market.btcPrice, market.btcFetchedAt, 15 * 60_000],
    ["fng", market.fng, market.fngFetchedAt, 36 * 3_600_000]
  ].map(([key, value, asOf, maxAge]) => {
    const observed = timestamp(asOf);
    const age = now.getTime() - observed;
    const valid = Number.isFinite(value) && (key === "btc" ? value > 0 && market.btcCurrency === "USD" : value >= 0 && value <= 100);
    const state = !valid || !Number.isFinite(age) || age < 0 ? "unknown" : age > maxAge ? "stale" : "fresh";
    return [key, { state, eligible: state === "fresh", asOf: Number.isFinite(observed) ? asOf : null }];
  }));
}

export function weekdaysSince(date, now = new Date()) {
  const start = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(start.getTime())) return Infinity;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const end = new Date(`${today}T00:00:00Z`);
  const days = Math.max(0, Math.floor((end - start) / DAY));
  let count = Math.floor(days / 7) * 5;
  for (let i = 1; i <= days % 7; i++) {
    const weekday = (start.getUTCDay() + i) % 7;
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

function timestamp(raw) {
  if (typeof raw !== "string") return NaN;
  if (/^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} (?:GMT|UTC|\+0000)$/.test(raw)) return Date.parse(raw);
  // Some providers expose an explicit daily observation such as "2026-09-04 ECB 日终".
  const date = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!date || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return NaN;
  return Date.parse(raw.includes("T") ? raw : `${date}T00:00:00+08:00`);
}

export function cardQuality(card, now = new Date()) {
  if (card.id === 3) return stablecoinQuality(card.stablecoin, now);
  const asOf = card.dataAsOf || card.marketQuote?.asOf || card.marketFetchedAt;
  if (card.id === 2) {
    const basis = mnavBasisQuality(card.basisAsOf, card.mnavMode, now);
    if (!basis.eligible) return { ...basis, asOf: asOf || null };
  }
  const observed = timestamp(asOf);
  if (!Number.isFinite(observed)) return { state: "unknown", eligible: false, asOf: null };
  if (observed > now.getTime()) return { state: "unknown", eligible: false, asOf };
  const ageDays = (now.getTime() - observed) / DAY;
  let stale;
  if ([7, 8].includes(card.id)) {
    const row = card.onchain;
    if (row?.metric !== ONCHAIN[card.id].metric || !Number.isSafeInteger(row.timestamp) || row.timestamp % 86400 !== 0 || row.timestamp * 1000 !== observed || !Number.isFinite(row.value) || onchainAgeDays(row.timestamp, now) < 1) return { state: "unknown", eligible: false, asOf };
    stale = onchainAgeDays(row.timestamp, now) > 3;
  }
  else if ([1, 2].includes(card.id)) stale = tradingDaysSince(asOf.slice(0, 10), now) > 2;
  else if (card.id === 4) stale = ageDays > 45;
  else if (card.id === 9) stale = ageDays > 1;
  else if ([3, 5, 6].includes(card.id)) stale = ageDays > 3;
  // Legacy manual readings without a validated metric observation stay unverified.
  else return { state: "unknown", eligible: false, asOf };
  return { state: stale ? "stale" : "fresh", eligible: !stale, asOf, ageDays };
}

export function assessCards(cards, now = new Date()) {
  const assessed = cards.map((card) => ({ ...card, quality: cardQuality(card, now) }));
  return { cards: assessed, coverage: assessed.filter((card) => card.quality.eligible).length };
}
