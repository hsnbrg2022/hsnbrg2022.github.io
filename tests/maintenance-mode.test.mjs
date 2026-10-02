import test from "node:test";
import assert from "node:assert/strict";
import { detectLocalMaintenance } from "../maintenance-mode.js";

const location = { protocol: "http:", hostname: "127.0.0.1" };
const capability = () => ({ schemaVersion: 1, service: "crypto-dashboard-tracker", requestProtection: "same-origin-json-v1", maintenance: { etf: true, positioning: true, refresh: true, snapshot: true } });
const response = value => ({ ok: true, json: async () => value });

test("Pages and file previews never probe maintenance APIs", async () => {
  let calls = 0;
  for (const loc of [{ protocol: "https:", hostname: "hsnbrg2022.github.io" }, { protocol: "file:", hostname: "" }, { protocol: "http:", hostname: "dashboard.test" }, { protocol: "https:", hostname: "localhost" }]) {
    assert.equal(await detectLocalMaintenance(loc, async () => { calls++; }), false);
  }
  assert.equal(calls, 0);
});

test("loopback requires a complete protected-backend capability contract", async () => {
  for (const hostname of ["127.0.0.1", "localhost"]) {
    assert.equal(await detectLocalMaintenance({ ...location, hostname }, async (url, options) => {
      assert.equal(url, "/api/capabilities"); assert.equal(options.cache, "no-store"); assert.equal(options.redirect, "error");
      assert.ok(options.signal); return response(capability());
    }), true);
  }
  for (const value of [null, {}, { ...capability(), schemaVersion: 2 }, { ...capability(), service: "other" }, { ...capability(), requestProtection: undefined }, { ...capability(), maintenance: { etf: true } }, { ...capability(), maintenance: { ...capability().maintenance, snapshot: "true" } }]) {
    assert.equal(await detectLocalMaintenance(location, async () => response(value)), false);
  }
});

test("static HTML, offline, HTTP errors and delayed bodies fail closed to browser mode", async () => {
  for (const fetchImpl of [async () => { throw new Error("offline"); }, async () => ({ ok: false }), async () => ({ ok: true, json: async () => { throw new Error("HTML not JSON"); } })]) {
    assert.equal(await detectLocalMaintenance(location, fetchImpl), false);
  }
  for (const waitForBody of [false, true]) {
    const fetchImpl = async (_url, { signal }) => {
      const wait = () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
      if (!waitForBody) return wait();
      return { ok: true, json: wait };
    };
    assert.equal(await detectLocalMaintenance(location, fetchImpl, { timeoutMs: 5 }), false);
  }
});
