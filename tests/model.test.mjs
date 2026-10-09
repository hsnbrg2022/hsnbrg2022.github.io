import test from "node:test";
import assert from "node:assert/strict";
import { calculateBookAccountRatio, calculateDxyFromRates, derivePositioningSignal } from "../model.js";

test("仓帐比只由仓位比和账户比计算", () => {
  assert.equal(calculateBookAccountRatio(1.14, 1.96)?.toFixed(2), "1.72");
  assert.equal(calculateBookAccountRatio(0, 1.96), null);
  assert.equal(calculateBookAccountRatio("", 1.96), null);
});

test("手工多空比自动生成仓帐比与信号等级", () => {
  const signal = derivePositioningSignal(1.07, 1.89);
  assert.equal(signal.positioning.bookAccountRatio.toFixed(2), "1.77");
  assert.equal(signal.status, "green");
  assert.equal(signal.headline, "机构锁仓做多（S+级）");
  assert.match(signal.change, /仓帐比1\.77/);
  assert.equal(derivePositioningSignal(0, 1.8), null);
});

test("使用美元篮子权重推导 DXY", () => {
  const value = calculateDxyFromRates({ EUR: 0.85477, JPY: 158.7, GBP: 0.73228, CAD: 1.374, SEK: 9.4559, CHF: 0.79947 });
  assert.ok(value > 95 && value < 105);
  assert.equal(calculateDxyFromRates({ EUR: 0 }), null);
});
