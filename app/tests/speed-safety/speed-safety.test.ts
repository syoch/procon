import { expect, test } from "vitest";
import {
  SPEED_SAFETY_CENTER,
  SPEED_SAFETY_MAX,
  sliderToLambda,
} from "../../src/lib/speed_safety";

test("左端は λ = 0 (速さ優先)", () => {
  expect(sliderToLambda(0)).toBe(0);
});

test("中央は λ = 1 (各モードの既定と同じ)", () => {
  expect(sliderToLambda(SPEED_SAFETY_CENTER)).toBe(1);
});

test("右端は λ = 3 (安全優先)", () => {
  expect(sliderToLambda(SPEED_SAFETY_MAX)).toBe(3);
});

test("左半分は 0〜1、右半分は 1〜3 を直線でつなぐ", () => {
  expect(sliderToLambda(25)).toBe(0.5);
  expect(sliderToLambda(75)).toBe(2);
});

test("右へ動かすほど λ が大きくなる", () => {
  let previous = -1;
  for (let position = 0; position <= SPEED_SAFETY_MAX; position += 5) {
    const lambda = sliderToLambda(position);
    expect(lambda).toBeGreaterThan(previous);
    previous = lambda;
  }
});

test("小数第 3 位までの値を返す", () => {
  // 丸める前は 1.3599999999999999 と 1.6400000000000001 になる位置
  expect(sliderToLambda(59)).toBe(1.36);
  expect(sliderToLambda(66)).toBe(1.64);
});

test("範囲の外は端の値にする (API は負の λ を 400 にする)", () => {
  expect(sliderToLambda(-10)).toBe(0);
  expect(sliderToLambda(150)).toBe(3);
});
