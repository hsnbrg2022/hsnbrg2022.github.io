import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { updateWeeklyMean, WEEKLY_RULE, validateWeeklySnapshot } from "../weekly-mean.js";

export async function buildWeeklySnapshot(fetchImpl = globalThis.fetch, now = new Date()) {
  const data = { market: { btcPrice: 1 } };
  await updateWeeklyMean(data, fetchImpl, now);
  const { rows, ...observation } = data.market.wmaObservation;
  const dataset = { schemaVersion: 1, rule: WEEKLY_RULE, generatedAt: now.toISOString(),
    ...observation, source: { label: "Yahoo Finance", url: "https://finance.yahoo.com/quote/BTC-USD/history/" }, rows };
  validateWeeklySnapshot(dataset, now);
  return dataset;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = fileURLToPath(new URL("../weekly-mean.json", import.meta.url));
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const dataset = await buildWeeklySnapshot();
    const previous = await readFile(file, "utf8").then(JSON.parse).catch(() => null);
    if (previous?.rule !== dataset.rule || previous?.asOf !== dataset.asOf || previous?.value !== dataset.value || JSON.stringify(previous?.rows) !== JSON.stringify(dataset.rows)) {
      await writeFile(temp, `${JSON.stringify(dataset, null, 2)}\n`, { flag: "wx" });
      await rename(temp, file);
    }
    console.log(`200WMA: ${dataset.value.toFixed(2)} · ${dataset.asOf} · ${dataset.sampleCount} completed weeks`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await unlink(temp).catch(() => {}); }
}
