const XAU_SPOT = "XAU-USD-SPOT";
const GOLD_PROVIDER = "https://api.goldprice.dev/v1/";
const DAY_MS = 86_400_000;

function goldReference(reference, observed) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reference?.date) || !Number.isFinite(reference.price) || reference.price <= 0) return null;
  const start = new Date(`${reference.date}T00:00:00Z`);
  if (!Number.isFinite(+start) || start.toISOString().slice(0, 10) !== reference.date) return null;
  const age = observed - (+start + DAY_MS);
  return age >= 0 && age <= 4 * DAY_MS ? reference : null;
}

export function goldSpotQuote(snapshot, now = new Date()) {
  const observed = Date.parse(snapshot?.observedAt);
  const age = +now - observed;
  if (snapshot?.schemaVersion !== 1 || snapshot.instrument !== XAU_SPOT
    || !Number.isFinite(snapshot.price) || snapshot.price <= 0
    || !Number.isFinite(age) || age < 0 || age > 45 * 60_000) throw new Error("黄金现货报价不可核验");
  const reference = goldReference(snapshot.reference, observed);
  return {
    price: snapshot.price, instrument: XAU_SPOT, fetchedLabel: new Date(observed).toISOString(),
    source: "GoldPrice.dev", sourceUrl: "https://goldprice.dev/prices/xau-usd", delayMinutes: 15,
    change: reference ? (snapshot.price / reference.price - 1) * 100 : null,
    changeBasis: reference ? "daily-reference" : null, comparisonAsOf: reference?.date ?? null
  };
}

export async function collectGoldSpot({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const fetchJson = async url => {
    const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(2800), redirect: "error" });
    if (!response.ok) throw new Error(`GoldPrice.dev HTTP ${response.status}`);
    return response.json();
  };
  const endpoint = (route, params) => new URL(`${route}?${new URLSearchParams({ symbol: XAU_SPOT, ...params })}`, GOLD_PROVIDER);
  const date = ms => new Date(ms).toISOString().slice(0, 10);
  const [priceResult, barsResult] = await Promise.allSettled([
    fetchJson(endpoint("prices")),
    fetchJson(endpoint("bars", { interval: "1d", from: date(+now - 7 * DAY_MS), to: date(+now), limit: 8 }))
  ]);
  if (priceResult.status === "rejected") throw priceResult.reason;
  const spot = priceResult.value.symbols?.find(row => row.symbol === "XAU" && row.quote_currency === "USD"
    && row.contract_type === "spot" && row.unit === "troy_ounce");
  if (!spot || spot.is_stale !== false) throw new Error("黄金现货报价不可核验");
  const snapshot = { schemaVersion: 1, instrument: XAU_SPOT, price: Number(spot.price), observedAt: spot.computed_at, reference: null };
  snapshot.observedAt = goldSpotQuote(snapshot, now).fetchedLabel;
  if (barsResult.status === "fulfilled") {
    const payload = barsResult.value;
    if (payload.symbol === XAU_SPOT && payload.interval === "1d" && Array.isArray(payload.bars)) {
      const settled = payload.bars
        .filter(bar => bar.is_closed === true && /^\d{4}-\d{2}-\d{2}T00:00:00(?:\.0+)?(?:Z|\+00:00)$/.test(bar.bar_start))
        .map(bar => ({ date: bar.bar_start.slice(0, 10), price: Number(bar.close) }))
        .filter(bar => goldReference(bar, Date.parse(snapshot.observedAt)))
        .sort((a, b) => b.date.localeCompare(a.date));
      const reference = settled[0];
      if (reference && !settled.some(bar => bar.date === reference.date && bar.price !== reference.price)) snapshot.reference = reference;
    }
  }
  return snapshot;
}

// Source observations carry their comparison basis; display text is never an input.
export function applyMacroQuote(target, quote, { id, prefix = "", now = new Date() } = {}) {
  const price = Number(quote.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("宏观行情价格无效");
  const knownGold = ["GC=F", "XAU-USD-SPOT"].includes(quote.instrument);
  const hasChange = Number.isFinite(quote.change) && ["previous-close", "daily-reference"].includes(quote.changeBasis) && (id !== 6 || knownGold);
  const change = hasChange ? quote.change : null;
  const changeText = hasChange
    ? `${quote.changeBasis === "previous-close" ? "较前收" : "较上个日终"} ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
    : "涨跌基准暂不可用";
  const asOf = quote.fetchedLabel || null;
  const changedInstrument = Boolean(target.marketQuote?.instrument && target.marketQuote.instrument !== quote.instrument);
  target.marketQuote = {
    price, changePct: change, instrument: quote.instrument,
    ...(id === 5 ? { kind: quote.instrument === "DX-Y.NYB" ? "actual-index" : "fx-basket-approximation", sourceChanged: changedInstrument } : {}),
    ...(id === 6 ? { kind: quote.instrument === "GC=F" ? "gold-futures" : quote.instrument === "XAU-USD-SPOT" ? "gold-spot" : "unverified", sourceChanged: changedInstrument } : {}),
    asOf, fetchedAt: now.toISOString(), comparison: hasChange ? { kind: quote.changeBasis, asOf: quote.comparisonAsOf || null } : null
  };
  target.headline = `${prefix}${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${changeText}`;
  target.change = changeText;
  if (id === 5) {
    target.facts = [quote.instrument === "DX-Y.NYB" ? "美元指数行情" : quote.instrument === "DXY-ECB" ? "ECB 六币日终近似" : "六币汇率快照近似",
      price < 100 ? "守在 100 下方" : "升至 100 上方", hasChange ? change < 0 ? "风险资产顺风" : "美元走强施压" : "涨跌基准暂不可用"];
    if (changedInstrument) target.facts.push("来源口径已切换，未拼接旧源涨幅");
    target.status = price < 100 ? "green" : price < 103 ? "yellow" : "red";
    target.detail = price < 100 ? "美元指数维持弱势，为风险资产提供宏观顺风。" : "美元指数走强，风险资产的流动性环境承压。";
  } else {
    target.facts = [quote.instrument === "GC=F" ? "黄金期货" : quote.instrument === "XAU-USD-SPOT" ? "黄金现货" : "黄金标的待核验", hasChange ? change >= 0 ? "较基准走强" : "较基准回落" : "涨跌基准暂不可用"];
    if (quote.delayMinutes === 15 && asOf) {
      const quoteTime = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short", hourCycle: "h23" }).format(new Date(asOf));
      target.facts.push(`报价 ${quoteTime} 北京时间（延迟约 15 分钟）`);
    }
    if (hasChange && quote.changeBasis === "daily-reference" && quote.comparisonAsOf) target.facts.push(`日终基准 ${quote.comparisonAsOf} UTC`);
    if (changedInstrument) target.facts.push("来源口径已切换，未拼接旧源涨幅");
    target.status = hasChange && change >= -1 ? "green" : "yellow";
    target.detail = "黄金用于交叉验证美元、实际利率与避险需求的变化。";
  }
  target.source = { label: quote.source, url: quote.sourceUrl };
  target.marketFetchedAt = asOf;
  target.dataAsOf = asOf;
  target.refreshStatus = "ok";
  return `${target.shortName} / ${quote.source}`;
}
