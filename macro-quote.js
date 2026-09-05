// Source observations carry their comparison basis; display text is never an input.
export function applyMacroQuote(target, quote, { id, prefix = "", now = new Date() } = {}) {
  const price = Number(quote.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("宏观行情价格无效");
  const hasChange = Number.isFinite(quote.change) && Boolean(quote.changeBasis);
  const change = hasChange ? quote.change : null;
  const changeText = hasChange
    ? `${quote.changeBasis === "previous-close" ? "较前收" : "较上个日终"} ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
    : "涨跌基准暂不可用";
  const asOf = quote.fetchedLabel || null;
  target.marketQuote = {
    price, changePct: change, instrument: quote.instrument,
    asOf, fetchedAt: now.toISOString(), comparison: hasChange ? { kind: quote.changeBasis, asOf: quote.comparisonAsOf || null } : null
  };
  target.headline = `${prefix}${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · ${changeText}`;
  target.change = changeText;
  if (id === 5) {
    target.facts = [price < 100 ? "守在 100 下方" : "升至 100 上方", hasChange ? change < 0 ? "风险资产顺风" : "美元走强施压" : "涨跌基准暂不可用"];
    target.status = price < 100 ? "green" : price < 103 ? "yellow" : "red";
    target.detail = price < 100 ? "美元指数维持弱势，为风险资产提供宏观顺风。" : "美元指数走强，风险资产的流动性环境承压。";
  } else {
    target.facts = [quote.instrument === "GC=F" ? "黄金期货" : "黄金现货", hasChange ? change >= 0 ? "较基准走强" : "较基准回落" : "涨跌基准暂不可用"];
    target.status = hasChange && change >= -1 ? "green" : "yellow";
    target.detail = "黄金用于交叉验证美元、实际利率与避险需求的变化。";
  }
  target.source = { label: quote.source, url: quote.sourceUrl };
  target.marketFetchedAt = asOf;
  target.refreshStatus = "ok";
  return `${target.shortName} / ${quote.source}`;
}
