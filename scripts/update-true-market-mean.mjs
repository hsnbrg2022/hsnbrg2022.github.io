#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_FILE = path.join(SITE_DIR, "true-market-mean.json");
const DASHBOARD_FILE = path.join(SITE_DIR, "dashboard.json");
const MCP_URL = "https://mcp.glassnode.com";
const AVIV_ENDPOINT = "/v1/metrics/indicators/aviv";
const PRICE_ENDPOINT = "/v1/metrics/market/price_usd_close";
const DAY_MS = 86_400_000;

export function parseSseJson(text) {
  const data = String(text).split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .join("\n");
  if (!data) return null;
  return JSON.parse(data);
}

export function parseMetricRows(payload) {
  const block = payload?.result?.content?.find((item) => item.type === "text")?.text;
  if (!block) throw new Error("Glassnode MCP 没有返回指标文本");
  const parsed = JSON.parse(block);
  const rows = parsed.raw_data || parsed.data || [];
  return rows.map((row) => ({
    timestamp: Number(row.t ?? row.timestamp),
    value: Number(row.v ?? row.value)
  })).filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.value));
}

async function mcpRequest(fetchImpl, body, sessionId = "") {
  const response = await fetchImpl(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Glassnode MCP HTTP ${response.status}`);
  return { payload: text ? parseSseJson(text) : null, sessionId: response.headers.get("mcp-session-id") || sessionId };
}

export async function fetchGlassnodeMetricRows(endpoint, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const initialized = await mcpRequest(fetchImpl, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "crypto-dashboard-true-market-mean", version: "1.0" }
    }
  });
  if (!initialized.sessionId) throw new Error("Glassnode MCP 没有建立会话");
  await mcpRequest(fetchImpl, {
    jsonrpc: "2.0", method: "notifications/initialized", params: {}
  }, initialized.sessionId);

  const since = Math.floor((now.getTime() - 5 * DAY_MS) / 1000).toString();
  const result = await mcpRequest(fetchImpl, {
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "fetch_metric",
      arguments: { endpoint, params: { a: "BTC", i: "24h", s: since } }
    }
  }, initialized.sessionId);
  if (result.payload?.error) throw new Error(`Glassnode MCP：${result.payload.error.message || "指标请求失败"}`);
  return parseMetricRows(result.payload);
}

function utcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function calculateTrueMarketMean({ avivRows, priceRows, now = new Date(), publishedMetric, previous = null }) {
  const prices = new Map(priceRows.map((row) => [Number(row.timestamp), Number(row.value)]));
  const aligned = avivRows.map((row) => ({
    timestamp: Number(row.timestamp), aviv: Number(row.value), priceUsdClose: prices.get(Number(row.timestamp))
  })).filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.aviv) && Number.isFinite(row.priceUsdClose))
    .sort((left, right) => left.timestamp - right.timestamp);
  if (!aligned.length) throw new Error("AVIV 与 BTC 收盘价没有相同 UTC 日期");

  const latest = aligned.at(-1);
  if (latest.aviv < 0.2 || latest.aviv > 5) throw new Error("AVIV 超出合理范围");
  if (latest.priceUsdClose < 1_000 || latest.priceUsdClose > 1_000_000) throw new Error("BTC 收盘价超出合理范围");
  const value = latest.priceUsdClose / latest.aviv;
  if (value < 1_000 || value > 500_000) throw new Error("True Market Mean 超出合理范围");

  const dataDate = new Date(latest.timestamp * 1000);
  const ageDays = Math.max(0, Math.floor((utcDay(now) - utcDay(dataDate)) / DAY_MS));
  if (ageDays > 3) throw new Error(`Glassnode 最新完整日已滞后 ${ageDays} 天`);
  if (previous?.value && Math.abs((value / Number(previous.value)) - 1) > 0.1) {
    throw new Error("True Market Mean 较上一快照跳变超过 10%");
  }

  const publishedValue = Number(publishedMetric?.value);
  return {
    schemaVersion: 1,
    status: "active",
    generatedAt: now.toISOString(),
    asOf: dataDate.toISOString().slice(0, 10),
    value: Number(value.toFixed(2)),
    formula: "glassnode_price_usd_close / glassnode_aviv",
    inputs: {
      priceUsdClose: latest.priceUsdClose,
      aviv: latest.aviv,
      timestamp: latest.timestamp
    },
    comparison: {
      publishedValue: Number.isFinite(publishedValue) ? publishedValue : null,
      deviationFromPublishedPct: Number.isFinite(publishedValue)
        ? Number((((value / publishedValue) - 1) * 100).toFixed(2))
        : null
    },
    validation: { sameUtcTimestamp: true, dataAgeDays: ageDays, activation: "active" },
    source: {
      label: "Glassnode Public MCP",
      url: "https://studio.glassnode.com/charts/indicators.Aviv?a=BTC",
      endpoint: MCP_URL,
      metrics: [AVIV_ENDPOINT, PRICE_ENDPOINT]
    }
  };
}

function sameObservation(left, right) {
  return Boolean(left && right)
    && left.asOf === right.asOf
    && left.value === right.value
    && left.inputs?.timestamp === right.inputs?.timestamp
    && left.inputs?.aviv === right.inputs?.aviv
    && left.inputs?.priceUsdClose === right.inputs?.priceUsdClose
    && left.status === right.status
    && left.validation?.activation === right.validation?.activation;
}

export async function updateTrueMarketMean({ fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  let previous = null;
  try { previous = JSON.parse(await readFile(OUTPUT_FILE, "utf8")); } catch {}
  const dashboard = JSON.parse(await readFile(DASHBOARD_FILE, "utf8"));
  const [avivRows, priceRows] = await Promise.all([
    fetchGlassnodeMetricRows(AVIV_ENDPOINT, { fetchImpl, now }),
    fetchGlassnodeMetricRows(PRICE_ENDPOINT, { fetchImpl, now })
  ]);
  const candidate = calculateTrueMarketMean({
    avivRows, priceRows, now, publishedMetric: dashboard.trueMarketMean, previous
  });
  if (sameObservation(previous, candidate)) return { dataset: previous, changed: false };
  await writeFile(OUTPUT_FILE, `${JSON.stringify(candidate, null, 2)}\n`);
  return { dataset: candidate, changed: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  updateTrueMarketMean().then(({ dataset, changed }) => {
    console.log(changed
      ? `True Market Mean 自动快照已更新：${dataset.asOf} · $${dataset.value.toLocaleString("en-US")}`
      : "True Market Mean 自动快照没有变化。");
  }).catch((error) => {
    console.error(`True Market Mean 自动更新失败，保留最后有效数据：${error.message}`);
    process.exitCode = 1;
  });
}
