import { expect, test } from "vitest";
import { formatDuration } from "../../src/lib/utils/duration";

test("分に丸めて表示する", () => {
  expect(formatDuration(744)).toBe("約 12 分");
  expect(formatDuration(846)).toBe("約 14 分");
});

test("1 分に満たない値は 1 分にする", () => {
  expect(formatDuration(0)).toBe("約 1 分");
  expect(formatDuration(29)).toBe("約 1 分");
});

test("60 分以上は時間と分に分ける", () => {
  expect(formatDuration(3600)).toBe("約 1 時間");
  expect(formatDuration(3900)).toBe("約 1 時間 5 分");
  expect(formatDuration(5 * 3600 + 23 * 60)).toBe("約 5 時間 23 分");
});

test("59 分 30 秒以上は 1 時間に繰り上げる", () => {
  expect(formatDuration(59 * 60 + 29)).toBe("約 59 分");
  expect(formatDuration(59 * 60 + 30)).toBe("約 1 時間");
});
