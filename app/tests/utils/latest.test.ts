import { expect, test } from "vitest";
import { createLatestGuard } from "../../src/lib/utils/latest";

test("始めた処理が 1 つなら、それが最後の処理", () => {
  const guard = createLatestGuard();
  const isLatest = guard.begin();
  expect(isLatest()).toBe(true);
});

test("次の処理を始めると、前の処理は最後ではなくなる", () => {
  const guard = createLatestGuard();
  const first = guard.begin();
  const second = guard.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
});

test("3 つ続けて始めたら、最後の 1 つだけが残る", () => {
  const guard = createLatestGuard();
  const checks = [guard.begin(), guard.begin(), guard.begin()];
  expect(checks.map((isLatest) => isLatest())).toEqual([false, false, true]);
});

test("先に始めた処理の応答が後から届いても、後に始めた処理の結果が残る", async () => {
  const guard = createLatestGuard();
  let shown = "";
  const search = async (name: string, response: Promise<void>) => {
    const isLatest = guard.begin();
    await response;
    if (!isLatest()) return;
    shown = name;
  };

  let finishSlow = () => {};
  const slow = search("左端", new Promise<void>((resolve) => (finishSlow = resolve)));
  const fast = search("右端", Promise.resolve());

  await fast;
  expect(shown).toBe("右端");
  finishSlow();
  await slow;
  expect(shown).toBe("右端");
});

test("別々に作ったものは互いに影響しない", () => {
  const a = createLatestGuard();
  const b = createLatestGuard();
  const fromA = a.begin();
  b.begin();
  b.begin();
  expect(fromA()).toBe(true);
});
