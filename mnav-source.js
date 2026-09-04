const SOURCE_URL = "https://mstr.fuckbtc.com/";

function text(value) {
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function capture(html, pattern, label) {
  const match = html.match(pattern);
  if (!match) throw new Error(`${label} 未找到`);
  return text(match[1]);
}

function number(value, label) {
  const match = String(value).replaceAll(",", "").match(/\d+(?:\.\d+)?/);
  const parsed = Number(match?.[0]);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} 无效`);
  return parsed;
}

function valueAfterLabel(html, label) {
  return capture(html, new RegExp(`${label}[\\s\\S]{0,260}?<div class="tile-value[^>]*">([\\s\\S]*?)</div>`, "i"), label);
}

export function parseMnavSourceHtml(html) {
  if (typeof html !== "string" || !html) throw new Error("mNAV 来源返回为空");
  const mnavText = capture(html, /mNAV\s*·\s*EV<\/div>\s*<div class="hero-value[^>]*">([\s\S]*?)<\/div>/i, "mNAV");
  if (/n\/?a|暂无|等待/i.test(mnavText)) throw new Error("mNAV 暂无可用数值");
  const healthText = capture(html, /FLYWHEEL HEALTH<\/div>\s*<div class="hero-value[^>]*">([\s\S]*?)<\/div>/i, "飞轮评分");
  const strcText = capture(html, /data-live="STRC-price">([\s\S]*?)<\/div>/i, "STRC");
  const singleRunwayText = valueAfterLabel(html, "STRC-only runway");
  const globalRunwayText = valueAfterLabel(html, "Global runway");
  const reserveText = valueAfterLabel(html, "USD Reserve");
  const mnav = number(mnavText, "mNAV");
  const health = number(healthText, "飞轮评分");
  const strc = number(strcText, "STRC");
  const singleRunwayMonths = number(singleRunwayText, "单券 Runway");
  const globalRunwayMonths = number(globalRunwayText, "全局 Runway");
  const reserveBillions = number(reserveText, "美元储备") / (/[MB]\b/i.test(reserveText) && /M\b/i.test(reserveText) ? 1000 : 1);
  return { mnav, health, strc, singleRunwayMonths, globalRunwayMonths, reserveBillions };
}

export function applyMnavSourceToDashboard(data, quote, { fetchedAt = new Date().toISOString() } = {}) {
  const target = data.cards.find((item) => item.id === 2);
  if (!target) throw new Error("mNAV 卡片未找到");
  target.headline = `${quote.mnav.toFixed(2)}x · STRC $${quote.strc.toFixed(2)} · 飞轮 ${Math.round(quote.health)}/100`;
  target.facts = [
    `美元储备 $${quote.reserveBillions.toFixed(2)}B`,
    `单券 Runway ${quote.singleRunwayMonths.toFixed(1)}月`,
    `全局 Runway ${quote.globalRunwayMonths.toFixed(1)}月`
  ];
  target.detail = quote.mnav >= 1
    ? `mNAV ${quote.mnav.toFixed(2)}x，高于 1.0；飞轮与现金跑道数据来自来源页。`
    : `mNAV ${quote.mnav.toFixed(2)}x，低于 1.0；关注估值折价与飞轮健康度。`;
  target.status = quote.mnav >= 1 ? "green" : quote.mnav >= 0.9 ? "yellow" : "red";
  target.change = `mNAV ${quote.mnav.toFixed(2)}x · 飞轮 ${Math.round(quote.health)}/100`;
  target.source = { label: "MSTR Flywheel Monitor", url: SOURCE_URL };
  target.refresh = "auto";
  target.refreshStatus = "ok";
  target.refreshMessage = "mNAV / MSTR Flywheel Monitor";
  target.refreshMethod = "public-manual";
  target.marketFetchedAt = fetchedAt;
  target.lastRefreshAt = fetchedAt;
  return target;
}

export async function updateMnavFromSource(data, fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(`${SOURCE_URL}?v=${Date.now()}`, {
      cache: "no-store",
      headers: { accept: "text/html" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const quote = parseMnavSourceHtml(await response.text());
    applyMnavSourceToDashboard(data, quote);
    return "mNAV / MSTR Flywheel Monitor";
  } finally {
    clearTimeout(timer);
  }
}
