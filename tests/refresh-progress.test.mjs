import test from "node:test";
import assert from "node:assert/strict";
import { refreshPublicDashboard } from "../public-refresh.js";

const input = {
  market: { btcPrice: 75000, fng: 50 },
  cards: Array.from({ length: 9 }, (_, index) => ({ id: index + 1, headline: "fixture old value", status: "yellow", facts: [] })),
  previous: { changes: [] }
};
const offline = async () => { throw new Error("fixture offline"); };

test("progress counts completed checks, not successful updates, without changing input", async () => {
  const before = structuredClone(input), events = [];
  const result = await refreshPublicDashboard(input, { fetchImpl: offline, onProgress: event => events.push(event) });
  assert.equal(events.length, 13);
  assert.deepEqual(events.map(e => e.completed), Array.from({ length: 13 }, (_, i) => i));
  assert.ok(events.every(e => e.total === 12));
  assert.equal(new Set(events.slice(1).map(e => e.name)).size, 12);
  assert.ok(events.slice(1).every(e => e.status === "failed"));
  assert.equal(result.updated.length, 0);
  assert.equal(result.warnings.length, 12);
  assert.deepEqual(input, before);
});

test("progress callback failure cannot change source outcomes", async () => {
  const result = await refreshPublicDashboard(input, { fetchImpl: offline, onProgress: () => { throw new Error("view error"); } });
  assert.equal(result.warnings.length, 12);
  assert.ok(result.warnings.every(value => !value.includes("view error")));
});

test("fast checks report progress before a slow source finishes", async () => {
  let release, reached;
  const slow = new Promise(resolve => { release = resolve; });
  const early = new Promise(resolve => { reached = resolve; });
  const events = [];
  let finished = false, timer;
  const result = refreshPublicDashboard(input, {
    fetchImpl: async url => {
      if (url.includes("alternative.me")) {
        await slow;
        return { ok: true, json: async () => ({ data: [{ value: "50", timestamp: String(Math.floor(Date.now() / 1000)) }] }) };
      }
      return offline();
    },
    onProgress: event => { events.push(event); if (event.completed === 11) reached(); }
  }).then(value => { finished = true; return value; });
  try {
    await Promise.race([early, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("No early progress")), 2000); })]);
    assert.equal(finished, false);
    assert.equal(events.at(-1).completed, 11);
  } finally { clearTimeout(timer); release(); }
  await result;
  assert.equal(events.at(-1).name, "F&G");
  assert.equal(events.at(-1).status, "ok");
});
