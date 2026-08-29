#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { applyFedDatasetToDashboard, validateFedDataset } from "../fed-signals.js";

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FED_FILE = path.join(SITE_DIR, "fed-signals.json");
const DASHBOARD_FILE = path.join(SITE_DIR, "dashboard.json");
const PRESS_FEED_URL = "https://www.federalreserve.gov/feeds/press_monetary.xml";
const SPEECH_FEED_URL = "https://www.federalreserve.gov/feeds/speeches_and_testimony.xml";
const CALENDAR_URL = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";

function decodeEntities(value) {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&nbsp;", " ");
}

export function stripHtml(html) {
  return decodeEntities(String(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function tagValue(block, tag) {
  return decodeEntities(block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "").trim();
}

export function parseRssItems(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(([, block]) => {
    const published = new Date(tagValue(block, "pubDate"));
    return {
      title: tagValue(block, "title"),
      url: tagValue(block, "link"),
      guid: tagValue(block, "guid"),
      description: tagValue(block, "description"),
      category: tagValue(block, "category"),
      publishedAt: Number.isFinite(published.getTime()) ? published.toISOString() : ""
    };
  }).filter((item) => item.title && item.url && item.publishedAt);
}

function mixedNumber(value) {
  const normalized = String(value).trim();
  const mixed = normalized.match(/^(\d+)(?:-|\s+)(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  return Number(normalized);
}

export function parseFomcDecision(html) {
  const text = stripHtml(html);
  const rangeMatch = text.match(/target range for the federal funds rate at\s+(\d+(?:\.\d+|(?:-|\s+)\d+\/\d+)?)\s+to\s+(\d+(?:\.\d+|(?:-|\s+)\d+\/\d+)?)\s+percent/i);
  if (!rangeMatch) throw new Error("FOMC 公告未找到目标利率区间");
  const lower = mixedNumber(rangeMatch[1]);
  const upper = mixedNumber(rangeMatch[2]);
  let action;
  if (/decided to (?:maintain|keep)|maintained the target range/i.test(text)) action = "hold";
  else if (/(?:decided to )?(?:lower|reduce|decrease)(?:d)? the target range/i.test(text)) action = "cut";
  else if (/(?:decided to )?(?:raise|increase)(?:d)? the target range/i.test(text)) action = "hike";
  if (!action || !Number.isFinite(lower) || !Number.isFinite(upper)) throw new Error("FOMC 决策无法确定");
  return { action, targetRange: { lower, upper } };
}

const HAWKISH_PATTERNS = [
  /inflation (?:remains|is running) (?:too high|elevated|above)/i,
  /predominant focus (?:right now )?should be on prices/i,
  /upside inflation risks?/i,
  /do not tell me that underlying trends have meaningfully improved/i,
  /(?:raise|higher) (?:the target range|interest rates?)/i,
  /premature to (?:ease|cut)/i,
  /financial conditions (?:are|remain) not restrictive/i
];

const DOVISH_PATTERNS = [
  /downside risks? to (?:the )?(?:labor market|employment)/i,
  /room to (?:ease|lower|cut)/i,
  /(?:lower|reduce|cut) (?:the target range|interest rates?)/i,
  /less restrictive/i,
  /policy (?:is|has become) too restrictive/i,
  /support (?:the )?labor market/i,
  /inflation (?:has moved|is moving) sustainably toward 2 percent/i
];

export function classifyChairTone(html) {
  const text = stripHtml(html);
  const hawkishSignals = HAWKISH_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  const dovishSignals = DOVISH_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  const difference = hawkishSignals.length - dovishSignals.length;
  return {
    tone: difference >= 2 ? "hawkish" : difference <= -2 ? "dovish" : "neutral",
    confidence: Math.abs(difference) >= 3 ? "high" : Math.abs(difference) >= 2 ? "medium" : "low",
    scores: { hawkish: hawkishSignals.length, dovish: dovishSignals.length }
  };
}

const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Sept: 9, Oct: 10, Nov: 11, Dec: 12
};

function isoDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function parseMeetingCalendar(html, now = new Date()) {
  const meetings = [];
  for (const year of [now.getUTCFullYear(), now.getUTCFullYear() + 1]) {
    const headingIndex = html.indexOf(`${year} FOMC Meetings`);
    if (headingIndex < 0) continue;
    const footerIndex = html.indexOf('<div class="panel-footer">', headingIndex);
    const block = html.slice(headingIndex, footerIndex > headingIndex ? footerIndex : undefined);
    const pattern = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>[\s\S]*?fomc-meeting__date[^>]*>([^<]+)<\/div>/gi;
    for (const match of block.matchAll(pattern)) {
      const monthParts = match[1].trim().split("/");
      const dateParts = match[2].replace("*", "").trim().split(/[–-]/).map(Number);
      const startMonth = MONTHS[monthParts[0]];
      const endMonth = MONTHS[monthParts[1]] || startMonth;
      if (!startMonth || !endMonth || !dateParts[0] || !dateParts[1]) continue;
      meetings.push({
        startDate: isoDate(year, startMonth, dateParts[0]),
        endDate: isoDate(year, endMonth, dateParts[1]),
        url: CALENDAR_URL
      });
    }
  }
  const today = now.toISOString().slice(0, 10);
  return meetings.sort((left, right) => left.startDate.localeCompare(right.startDate))
    .find((meeting) => meeting.endDate >= today) || null;
}

function eventDate(item) {
  return item.publishedAt.slice(0, 10);
}

function speechTitle(item) {
  return item.title.includes(",") ? item.title.split(",").slice(1).join(",").trim() : item.title;
}

function speechAuthor(item) {
  return item.title.includes(",") ? item.title.split(",")[0].trim() : "Federal Reserve Chair";
}

async function latestChairItem(items, fetchText) {
  for (const item of items.slice(0, 8)) {
    const html = await fetchText(item.url);
    const text = stripHtml(html);
    const isChair = /\bChair(?:man|woman)?\s+[A-Z][a-z]+/.test(text.slice(0, 5_000));
    const isMonetary = /monetary policy|inflation|interest rates?|federal funds|price stability/i.test(text);
    if (isChair && isMonetary) return { item, html };
  }
  return null;
}

export async function buildFedDataset({ pressFeed, speechFeed, calendarHtml, fetchText, now = new Date(), previous = null }) {
  const statement = parseRssItems(pressFeed).find((item) => /^Federal Reserve issues FOMC statement$/i.test(item.title));
  if (!statement) throw new Error("官方 RSS 未找到 FOMC statement");
  const statementHtml = await fetchText(statement.url);
  const decision = parseFomcDecision(statementHtml);
  const chairResult = await latestChairItem(parseRssItems(speechFeed), fetchText);
  const nextMeeting = parseMeetingCalendar(calendarHtml, now) || previous?.nextMeeting;
  if (!nextMeeting) throw new Error("FOMC 日历未找到下一次会议");

  const chair = chairResult ? {
    eventDate: eventDate(chairResult.item),
    publishedAt: chairResult.item.publishedAt,
    author: speechAuthor(chairResult.item),
    title: speechTitle(chairResult.item),
    url: chairResult.item.url,
    ...classifyChairTone(chairResult.html),
    role: "secondary"
  } : previous?.chair || null;

  return validateFedDataset({
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    status: "live",
    source: { label: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/feeds.htm", method: "official-rss-and-html" },
    fomc: {
      eventDate: eventDate(statement),
      publishedAt: statement.publishedAt,
      title: statement.title,
      url: statement.url,
      ...decision,
      role: "primary"
    },
    chair,
    nextMeeting
  });
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: { accept: "text/html, application/rss+xml, application/xml;q=0.9", "user-agent": "CryptoDashboardFedTracker/1.0" },
    signal: AbortSignal.timeout(20_000)
  });
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}

function semanticDataset(dataset) {
  const value = structuredClone(dataset);
  delete value.generatedAt;
  return value;
}

export async function updateFedSignals({ now = new Date() } = {}) {
  let previous = null;
  try { previous = JSON.parse(await readFile(FED_FILE, "utf8")); } catch {}
  const [pressFeed, speechFeed, calendarHtml] = await Promise.all([
    fetchText(PRESS_FEED_URL), fetchText(SPEECH_FEED_URL), fetchText(CALENDAR_URL)
  ]);
  const candidate = await buildFedDataset({ pressFeed, speechFeed, calendarHtml, fetchText, now, previous });
  if (previous && JSON.stringify(semanticDataset(previous)) === JSON.stringify(semanticDataset(candidate))) {
    candidate.generatedAt = previous.generatedAt;
  }

  const dashboard = JSON.parse(await readFile(DASHBOARD_FILE, "utf8"));
  applyFedDatasetToDashboard(dashboard, candidate, { now });
  const fedJson = `${JSON.stringify(candidate, null, 2)}\n`;
  const dashboardJson = `${JSON.stringify(dashboard, null, 2)}\n`;
  const previousFedJson = previous ? `${JSON.stringify(previous, null, 2)}\n` : "";
  const previousDashboardJson = await readFile(DASHBOARD_FILE, "utf8");

  if (fedJson !== previousFedJson) await writeFile(FED_FILE, fedJson);
  if (dashboardJson !== previousDashboardJson) await writeFile(DASHBOARD_FILE, dashboardJson);
  return { dataset: candidate, changed: fedJson !== previousFedJson || dashboardJson !== previousDashboardJson };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateFedSignals().then(({ dataset, changed }) => {
    console.log(changed
      ? `Fed 官方信号已更新：FOMC ${dataset.fomc.eventDate}，主席讲话 ${dataset.chair?.eventDate || "无"}。`
      : "Fed 官方信号没有变化。");
  }).catch((error) => {
    console.error(`Fed 更新失败，保留最后有效数据：${error.message}`);
    process.exitCode = 1;
  });
}
