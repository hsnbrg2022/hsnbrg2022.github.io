import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const apiSource = source.slice(source.indexOf("async function api("), source.indexOf("\nfunction showToast("));

const localSource = source.slice(source.indexOf("async function refreshLocalWithProgress("), source.indexOf("\nasync function refreshData("));
function localHarness({ supported = true, get, post, onRender = () => {} }) {
  const calls = [], states = [];
  const context = {
    HAS_LOCAL_REFRESH_PROGRESS: supported,
    crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789abc" },
    AbortController, setTimeout, refreshState: null,
    api: async (url, options = {}) => {
      calls.push({ url, options });
      return options.method === "POST" ? post(options) : get(options);
    },
    render: () => { states.push(context.refreshState); onRender(context.refreshState); }
  };
  const run = vm.runInNewContext(localSource + "; refreshLocalWithProgress", context);
  return { run, calls, states };
}

test("legacy local refresh sends one non-cancelable POST without progress probes", async () => {
  const h = localHarness({ supported: false, get: () => { throw new Error("unexpected GET"); }, post: options => {
    assert.equal(options.signal, undefined); assert.equal(options.body, undefined); return { legacy: true };
  } });
  assert.equal((await h.run()).legacy, true);
  assert.equal(h.calls.length, 1);
});

test("local progress is optional, request-scoped and aborts only its GET after write completion", async () => {
  let release, rendered;
  const write = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { rendered = resolve; });
  let signal;
  const h = localHarness({ post: options => { assert.equal(options.signal, undefined); assert.match(options.body, /refreshId/); return write; },
    get: options => { signal = options.signal; return { schemaVersion: 1, available: true, total: 12, completed: 2,
      checks: [{ name: "BTC", status: "ok", message: "private-path" }, { name: "黄金", status: "failed" }] }; },
    onRender: () => rendered() });
  const pending = h.run();
  await ready;
  assert.equal(h.states[0].localProgress, true);
  assert.equal(h.states[0].completed, 2);
  assert.doesNotMatch(JSON.stringify(h.states[0]), /private-path|message/);
  release({ saved: true });
  assert.equal((await pending).saved, true);
  assert.equal(signal.aborted, true);
  assert.equal(h.calls.filter(c => c.options.method === "POST").length, 1);
});

test("missing or malformed progress falls back without retrying or canceling the POST", async () => {
  for (const invalid of [false, true]) {
    let release, rendered;
    const write = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { rendered = resolve; });
    const h = localHarness({ post: options => { assert.equal(options.signal, undefined); return write; },
      get: () => { if (invalid) return { available: true, total: 99, completed: 0, checks: [] }; throw new Error("/private/error"); },
      onRender: () => rendered() });
    const pending = h.run();
    await ready;
    assert.equal(h.states[0].total, null);
    release({ saved: true });
    assert.equal((await pending).saved, true);
    assert.equal(h.calls.filter(c => c.options.method === "POST").length, 1);
    assert.doesNotMatch(JSON.stringify(h.states), /private/);
  }
});
function harness(fetch, language = "zh") {
  const controller = new AbortController();
  const timeouts = [];
  const api = vm.runInNewContext(`${apiSource}; api`, {
    fetch, language,
    t: (lang, key) => key === "readTimeout" ? (lang === "en" ? "Read timed out" : "读取超时") : key,
    AbortSignal: { timeout: ms => { timeouts.push(ms); return controller.signal; }, any: AbortSignal.any }
  });
  return { api, timeouts, controller };
}

test("GET has a ten-second deadline covering JSON body reads in both languages", async () => {
  for (const language of ["zh", "en"]) {
    let signal;
    const h = harness(async (_url, options) => {
      signal = options.signal;
      return { ok: true, json: () => new Promise((_, reject) => {
        const abort = () => reject(new DOMException("body aborted", "AbortError"));
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }) };
    }, language);
    const result = h.api("./dashboard.json");
    assert.deepEqual(h.timeouts, [10000]);
    await Promise.resolve();
    h.controller.abort(new DOMException("deadline", "TimeoutError"));
    await assert.rejects(result, language === "en" ? /Read timed out/ : /读取超时/);
  }
});

test("POST has no automatic read deadline and preserves save results", async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ saved: true }) }));
  assert.equal((await h.api("/api/etf-flows", { method: "POST" })).saved, true);
  assert.deepEqual(h.timeouts, []);
});

test("network and busy failures retain their original meanings", async () => {
  const h = harness(async () => { throw new Error("offline"); });
  await assert.rejects(h.api("./etf-flows.json"), /offline/);
  const busy = harness(async () => ({ ok: false, json: async () => ({ code: "DASHBOARD_WRITE_BUSY" }) }));
  await assert.rejects(busy.api("/api/etf-flows", { method: "POST" }), /writeBusy/);
  assert.deepEqual(busy.timeouts, []);
});
