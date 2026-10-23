import test from "node:test";
import assert from "node:assert/strict";
import { refreshPublicDashboard } from "../public-refresh.js";

const input = {
  market: { btcPrice: 75000, fng: 50 },
  cards: Array.from({ length: 9 }, (_, index) => ({ id: index + 1, headline: "fixture old value", status: "yellow", facts: [] })),
  previous: { changes: [] }
};
const offline = async () => { throw new Error("fixture offline"); };

test("completed cards arrive before a slow source, without leaking unfinished mutations", async () => {
  let release, ready;
  const gate = new Promise(resolve => { release = resolve; });
  const early = new Promise(resolve => { ready = resolve; });
  let snapshot, finished = false;
  const original = structuredClone(input);
  const pending = refreshPublicDashboard(input, {
    fetchImpl: async url => {
      if (url.includes("alternative.me")) { await gate; return { ok: true, json: async () => ({ data: [{ value: "60", timestamp: String(Math.floor(Date.now() / 1000)) }] }) }; }
      if (url.includes("gold-api.com")) return { ok: true, json: async () => ({ price: 4800, updatedAt: new Date().toISOString() }) };
      return offline();
    },
    onProgress: event => { if (event.completed === 11) { snapshot = event; ready(); } }
  }).then(result => { finished = true; return result; });
  try {
    await early;
    assert.equal(finished, false);
    assert.match(snapshot.data.cards.find(c => c.id === 6).headline, /4,800/);
    assert.equal(snapshot.data.market.fng, 50);
    assert.equal(snapshot.checks.some(c => c.name === "F&G"), false);
    assert.equal(snapshot.data.cards.find(c => c.id === 2).refreshStatus, "failed");
    assert.deepEqual(input, original);
    snapshot.data.cards.find(c => c.id === 6).headline = "mutated callback";
  } finally { release(); }
  const result = await pending;
  assert.match(result.data.cards.find(c => c.id === 6).headline, /4,800/);
  assert.equal(result.data.market.fng, 60);
});

test("progress snapshots and check arrays cannot mutate internal outcomes", async () => {
  const result = await refreshPublicDashboard(input, { fetchImpl: offline, onProgress: event => {
    if (event.data) { event.data.market.btcPrice = 1; event.data.cards[0].headline = "tampered"; }
    if (event.checks[0]) event.checks[0].status = "tampered";
  } });
  assert.equal(result.data.market.btcPrice, 75000);
  assert.equal(result.data.cards[0].headline, "fixture old value");
  assert.ok(result.data.refreshChecks.every(c => c.status === "failed"));
});

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
