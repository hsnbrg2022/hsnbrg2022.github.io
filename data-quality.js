const DAY = 86400000;

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
  const asOf = card.dataAsOf || card.marketQuote?.asOf || card.marketFetchedAt;
  const observed = timestamp(asOf);
  if (!Number.isFinite(observed)) return { state: "unknown", eligible: false, asOf: null };
  if (observed > now.getTime()) return { state: "unknown", eligible: false, asOf };
  const ageDays = (now.getTime() - observed) / DAY;
  let stale;
  if ([1, 2].includes(card.id)) stale = weekdaysSince(asOf.slice(0, 10), now) > 2;
  else if (card.id === 4) stale = ageDays > 45;
  else if (card.id === 9) stale = ageDays > 1;
  else if ([3, 5, 6].includes(card.id)) stale = ageDays > 3;
  // No approved lifetime for manual on-chain readings yet; require verification.
  else return { state: "unknown", eligible: false, asOf };
  return { state: stale ? "stale" : "fresh", eligible: !stale, asOf, ageDays };
}

export function assessCards(cards, now = new Date()) {
  const assessed = cards.map((card) => ({ ...card, quality: cardQuality(card, now) }));
  return { cards: assessed, coverage: assessed.filter((card) => card.quality.eligible).length };
}
