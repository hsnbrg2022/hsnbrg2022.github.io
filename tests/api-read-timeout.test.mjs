import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app.js", import.meta.url), "utf8");
const apiSource = source.slice(source.indexOf("async function api("), source.indexOf("\nfunction showToast("));
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
