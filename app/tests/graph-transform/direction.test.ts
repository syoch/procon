import { expect, test } from "vitest";
import {
  canTraverseBackward,
  canTraverseForward,
  combineDirection,
  flipDirection,
} from "../../src/lib/utils/direction";

test("flipDirection は forward と backward を入れ替える", () => {
  expect(flipDirection("both")).toBe("both");
  expect(flipDirection("forward")).toBe("backward");
  expect(flipDirection("backward")).toBe("forward");
  expect(flipDirection("none")).toBe("none");
});

test("canTraverseForward / canTraverseBackward", () => {
  expect(canTraverseForward("both")).toBe(true);
  expect(canTraverseForward("forward")).toBe(true);
  expect(canTraverseForward("backward")).toBe(false);
  expect(canTraverseForward("none")).toBe(false);

  expect(canTraverseBackward("both")).toBe(true);
  expect(canTraverseBackward("forward")).toBe(false);
  expect(canTraverseBackward("backward")).toBe(true);
  expect(canTraverseBackward("none")).toBe(false);
});

test("combineDirection は連結方向の成分 AND をとる", () => {
  expect(combineDirection("both", "both")).toBe("both");
  expect(combineDirection("forward", "forward")).toBe("forward");
  expect(combineDirection("backward", "backward")).toBe("backward");
  expect(combineDirection("both", "forward")).toBe("forward");
  expect(combineDirection("both", "backward")).toBe("backward");
  // 連結方向に対して両立しない場合は通行不可
  expect(combineDirection("forward", "backward")).toBe("none");
  expect(combineDirection("none", "both")).toBe("none");
});
