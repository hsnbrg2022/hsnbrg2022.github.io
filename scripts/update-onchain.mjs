import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { fetchGlassnodeMetricRows } from "./update-true-market-mean.mjs";
import { ONCHAIN, validateOnchainDataset, applyOnchainDataset } from "../onchain-source.js";

export function buildOnchainDataset(id, primary, auxiliary = [], now = new Date()) {
  const config = ONCHAIN[id], days = new Map();
  for (const row of primary) {
    if (!Number.isSafeInteger(row.timestamp) || row.timestamp % 86400 !== 0 || typeof row.value !== "number" || !Number.isFinite(row.value)) throw new Error("Invalid daily metric row");
    if (days.has(row.timestamp) && days.get(row.timestamp).value !== row.value) throw new Error("Conflicting duplicate on-chain observation");
    if (row.timestamp * 1000 >= Math.floor(+now / 86400000) * 86400000) continue;
    days.set(row.timestamp, row);
  }
  const observation = [...days.values()].sort((a, b) => a.timestamp - b.timestamp).at(-1);
  if (!observation) throw new Error("No completed on-chain daily observation");
  const matching = auxiliary.filter(row => row.timestamp === observation.timestamp && typeof row.value === "number" && Number.isFinite(row.value) && row.value > 0 && row.value <= 100);
  const aux = matching.length && matching.every(row => row.value === matching[0].value) ? { ...matching[0], metric: config.auxiliary } : null;
  const dataset = { schemaVersion: 1, status: "active", asset: "BTC", interval: "24h", metric: config.metric,
    asOf: new Date(observation.timestamp * 1000).toISOString().slice(0, 10), generatedAt: now.toISOString(),
    value: observation.value, observation, auxiliary: aux,
    source: { label: "Glassnode Public MCP", endpoint: config.endpoint, url: `https://studio.glassnode.com/charts/${config.chart}?a=BTC` } };
  validateOnchainDataset(dataset, id, { now });
  return dataset;
}

export async function fetchOnchainDataset(id, { fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const config = ONCHAIN[id];
  const [primary, auxiliary] = await Promise.all([
    fetchGlassnodeMetricRows(config.endpoint, { fetchImpl, now }),
    fetchGlassnodeMetricRows(config.auxiliaryEndpoint, { fetchImpl, now }).catch(() => [])
  ]);
  return buildOnchainDataset(id, primary, auxiliary, now);
}

export async function updateLocalOnchain(data, id, { fetchImpl = globalThis.fetch, now = new Date(), readSnapshot } = {}) {
  try { return applyOnchainDataset(data, await fetchOnchainDataset(id, { fetchImpl, now }), id, { now, method: "official-daily" }); }
  catch (error) {
    if (!readSnapshot) throw error;
    return applyOnchainDataset(data, await readSnapshot(ONCHAIN[id].file), id, { now });
  }
}

export async function writeOnchainSnapshot(id, dataset, { directory = new URL("../", import.meta.url), now = new Date() } = {}) {
  validateOnchainDataset(dataset, id, { now });
  const file = new URL(ONCHAIN[id].file, directory);
  let previous;
  try { previous = JSON.parse(await readFile(file, "utf8")); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (previous?.observation?.timestamp > dataset.observation.timestamp) throw new Error("Refusing older on-chain snapshot");
  if (previous?.asOf === dataset.asOf && previous.value === dataset.value && JSON.stringify(previous.auxiliary) === JSON.stringify(dataset.auxiliary)) return false;
  const temp = new URL(`${ONCHAIN[id].file}.${randomUUID()}.tmp`, directory);
  try { await writeFile(temp, `${JSON.stringify(dataset, null, 2)}\n`); await rename(temp, file); }
  finally { await unlink(temp).catch(error => { if (error.code !== "ENOENT") throw error; }); }
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const results = await Promise.allSettled([7, 8].map(async id => {
    const dataset = await fetchOnchainDataset(id);
    const changed = await writeOnchainSnapshot(id, dataset);
    console.log(`${ONCHAIN[id].title}: ${dataset.asOf} · ${dataset.value} · ${changed ? "updated" : "unchanged"}`);
  }));
  for (const result of results) if (result.status === "rejected") { console.error(`On-chain update failed; previous snapshot retained: ${result.reason.message}`); process.exitCode = 1; }
}
