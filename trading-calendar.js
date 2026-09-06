// Verified NYSE full-day closures. Early-close sessions remain trading days.
// Source: https://www.nyse.com/trade/hours-calendars (checked 2026-09-05).
const HOLIDAYS = {
  2026: "01-01 01-19 02-16 04-03 05-25 06-19 07-03 09-07 11-26 12-25",
  2027: "01-01 01-18 02-15 03-26 05-31 06-18 07-05 09-06 11-25 12-24",
  2028: "01-17 02-21 04-14 05-29 06-19 07-04 09-04 11-23 12-25"
};

export function validTradingDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
  const time = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(+time) && time.toISOString().slice(0, 10) === date;
}

// null means outside verified calendar coverage, not an assumed open day.
export function isTradingDay(date) {
  if (!validTradingDate(date)) return false;
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  const holidays = HOLIDAYS[date.slice(0, 4)];
  return holidays ? !holidays.split(" ").includes(date.slice(5)) : null;
}

export function nextTradingDay(date) {
  if (!validTradingDate(date)) return null;
  const next = new Date(`${date}T00:00:00Z`);
  for (let i = 0; i < 10; i++) {
    next.setUTCDate(next.getUTCDate() + 1);
    const candidate = next.toISOString().slice(0, 10);
    const open = isTradingDay(candidate);
    if (open === null) return null;
    if (open) return candidate;
  }
  return null;
}

export function tradingDaysSince(date, now = new Date()) {
  if (!validTradingDate(date)) return Infinity;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  const cursor = new Date(`${date}T00:00:00Z`);
  let count = 0;
  while (cursor.toISOString().slice(0, 10) < today && count < 1000) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const open = isTradingDay(cursor.toISOString().slice(0, 10));
    if (open === null) return Infinity;
    if (open) count++;
  }
  return count;
}
