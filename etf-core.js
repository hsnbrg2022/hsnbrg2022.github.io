import { validTradingDate, isTradingDay, nextTradingDay } from "./trading-calendar.js";

export function normalizeEtfRows(rows) {
  if (!Array.isArray(rows)) throw new Error("ETF records must be an array");
  const unique = new Map();
  for (const row of rows) {
    if (!validTradingDate(row?.date) || isTradingDay(row.date) === false) throw new Error("ETF record has an invalid or closed trading date");
    if (row.flowUsdMillions === null || row.flowUsdMillions === undefined || row.flowUsdMillions === "" || !Number.isFinite(Number(row.flowUsdMillions))) throw new Error("ETF record is missing a valid flow (zero is allowed)");
    const next = { date: row.date, flowUsdMillions: Number(row.flowUsdMillions) };
    if (unique.has(row.date) && unique.get(row.date).flowUsdMillions !== next.flowUsdMillions) throw new Error("Conflicting ETF records for the same date");
    unique.set(row.date, next);
  }
  return [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function summarizeEtfFlows(rows) {
  const sorted = normalizeEtfRows(rows);
  if (!sorted.length) return null;
  const latest = sorted.at(-1);
  const direction = latest.flowUsdMillions > 0 ? "inflow" : latest.flowUsdMillions < 0 ? "outflow" : "flat";
  let streak = 0, cumulative = 0, gapAfter = null, calendarUnknown = isTradingDay(latest.date) === null;
  for (let i = sorted.length - 1; i >= 0 && direction !== "flat"; i--) {
    if (i < sorted.length - 1) {
      const expected = nextTradingDay(sorted[i].date);
      if (!expected) { calendarUnknown = true; break; }
      if (expected !== sorted[i + 1].date) { gapAfter = sorted[i].date; break; }
    }
    const value = sorted[i].flowUsdMillions;
    if ((direction === "inflow" && value <= 0) || (direction === "outflow" && value >= 0)) break;
    streak++;
    cumulative += value;
  }
  return { latest, direction, streak, cumulative, gapAfter, calendarUnknown, recent: sorted.slice(-4) };
}

export function etfSignal(dataset, { now = new Date() } = {}) {
  const s = summarizeEtfFlows(dataset.rows);
  if (!s) throw new Error("ETF data has no valid records");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(now);
  if (s.latest.date > today) throw new Error("ETF data contains a future trading date");
  const direction = s.direction === "inflow" ? "净流入" : "净流出";
  const sign = s.cumulative < 0 ? "−" : "";
  const total = Math.abs(s.cumulative) >= 1000 ? `${sign}$${(Math.abs(s.cumulative) / 1000).toFixed(1)}B` : `${sign}$${Math.abs(s.cumulative).toFixed(1)}M`;
  const note = s.calendarUnknown ? "交易日历待核验，连续性未确认。" : s.gapAfter ? `检测到缺少交易日记录，连续天数仅统计缺口之后。` : "";
  return {
    headline: s.direction === "flat" ? "最新交易日净流量持平" : `连续 ${s.streak} 日${direction} · 累计 ${total}`,
    facts: s.recent.map((row) => `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8))} ${row.flowUsdMillions > 0 ? "+" : row.flowUsdMillions < 0 ? "−" : ""}$${Math.abs(row.flowUsdMillions).toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M`),
    detail: note + (s.direction === "flat" ? "最新交易日 ETF 资金净流量持平。" : s.direction === "inflow" ? "ETF 资金连续净流入，机构配置需求保持支撑。" : "ETF 资金连续净流出，机构配置需求转弱。"),
    status: !s.calendarUnknown && s.direction === "inflow" && s.streak >= 2 ? "green" : !s.calendarUnknown && s.direction === "outflow" && s.streak >= 3 ? "red" : "yellow",
    change: s.direction === "flat" ? "最新交易日持平" : `连续${s.streak}日${direction}`,
    dataAsOf: s.latest.date,
    continuity: { gapAfter: s.gapAfter, calendarUnknown: s.calendarUnknown, rule: "nyse-calendar-2026-2028-v1" }
  };
}
