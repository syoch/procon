import { afterEach, expect, test, vi } from "vitest";
import { debounce } from "../../src/lib/utils/debounce";

afterEach(() => {
  vi.useRealTimers();
});

test("連続呼び出しでは最後の 1 回だけ実行する", () => {
  vi.useFakeTimers();
  const fn = vi.fn();
  const call = debounce(fn, 500);

  call();
  vi.advanceTimersByTime(300);
  call();
  vi.advanceTimersByTime(300);
  call();

  expect(fn).not.toHaveBeenCalled();
  vi.advanceTimersByTime(500);
  expect(fn).toHaveBeenCalledTimes(1);
});

test("待ち時間が過ぎたら実行する", () => {
  vi.useFakeTimers();
  const fn = vi.fn();
  const call = debounce(fn, 500);

  call();
  vi.advanceTimersByTime(499);
  expect(fn).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(fn).toHaveBeenCalledTimes(1);
});

test("cancel すると未実行の呼び出しを捨てる", () => {
  vi.useFakeTimers();
  const fn = vi.fn();
  const call = debounce(fn, 500);

  call();
  call.cancel();
  vi.advanceTimersByTime(1000);

  expect(fn).not.toHaveBeenCalled();
});

test("実行後は再び呼び出せる", () => {
  vi.useFakeTimers();
  const fn = vi.fn();
  const call = debounce(fn, 500);

  call();
  vi.advanceTimersByTime(500);
  call();
  vi.advanceTimersByTime(500);

  expect(fn).toHaveBeenCalledTimes(2);
});
