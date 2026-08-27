export const ETF_MANUAL_SOURCES = {
  sosovalue: {
    label: "SoSoValue",
    url: "https://sosovalue.com/zh/assets/etf/us-btc-spot"
  },
  farside: {
    label: "Farside",
    url: "https://farside.co.uk/btc/"
  }
};

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai"
  }).format(now);
}

export function nextEtfTradingDate(latestDate, now = new Date()) {
  if (!validCalendarDate(latestDate)) return shanghaiDate(now);
  const next = new Date(`${latestDate}T00:00:00Z`);
  do next.setUTCDate(next.getUTCDate() + 1);
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
  const candidate = next.toISOString().slice(0, 10);
  return candidate <= shanghaiDate(now) ? candidate : latestDate;
}

export function upsertManualEtfFlow(current, input, now = new Date()) {
  const date = String(input?.date || "").trim();
  const rawFlow = input?.flowUsdMillions;
  const flowUsdMillions = Number(rawFlow);
  const sourceKey = ETF_MANUAL_SOURCES[input?.sourceKey] ? input.sourceKey : "sosovalue";
  if (!validCalendarDate(date)) throw new Error("ETF 交易日期无效");
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) throw new Error("ETF 交易日期不能是周末");
  if (date > shanghaiDate(now)) throw new Error("ETF 交易日期不能晚于当前日期");
  if (rawFlow === "" || rawFlow === null || rawFlow === undefined || !Number.isFinite(flowUsdMillions) || Math.abs(flowUsdMillions) > 10_000) {
    throw new Error("ETF 净流量必须是 -10000 至 10000 之间的数字（百万美元）");
  }

  const rows = Array.isArray(current?.rows) ? current.rows : [];
  const normalized = rows.map((row) => ({
    date: String(row.date || ""),
    flowUsdMillions: Number(row.flowUsdMillions)
  })).filter((row) => validCalendarDate(row.date) && Number.isFinite(row.flowUsdMillions));
  const existed = normalized.some((row) => row.date === date);
  const unique = new Map(normalized.map((row) => [row.date, row]));
  unique.set(date, { date, flowUsdMillions });
  const outputRows = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
  const source = ETF_MANUAL_SOURCES[sourceKey];
  const verification = sourceKey === "sosovalue" ? ETF_MANUAL_SOURCES.farside : ETF_MANUAL_SOURCES.sosovalue;
  return {
    dataset: {
      schemaVersion: 1,
      asset: "BTC",
      unit: "USD_MILLIONS",
      status: "snapshot",
      marketDate: outputRows.at(-1).date,
      generatedAt: now.toISOString(),
      source: { ...source, method: "manual-entry" },
      verificationSource: verification,
      rows: outputRows
    },
    action: existed ? "updated" : "added"
  };
}
