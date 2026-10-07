import { expect, test, vi } from "vitest";
import type { Boundary } from "../../src/lib/osm/boundary";
import { requireOSMData } from "../../src/lib/osm";
import { RequestContext } from "$lib/tracing/requestContext";

const BOUNDARY: Boundary = {
  minLat: 0 / 64,
  minLng: 0 / 64,
  maxLat: 2 / 64,
  maxLng: 2 / 64,
};
const CACHED_BOUNDARY: Boundary[] = [
  {
    minLat: 0 / 64,
    minLng: 0 / 64,
    maxLat: 1 / 64,
    maxLng: 1 / 64,
  },
  {
    minLat: 1 / 64,
    minLng: 0 / 64,
    maxLat: 2 / 64,
    maxLng: 1 / 64,
  }
];
const UNCACHED_BOUNDARY: Boundary[] = [
  {
    minLat: 0 / 64,
    minLng: 1 / 64,
    maxLat: 1 / 64,
    maxLng: 2 / 64,
  },
  {
    minLat: 1 / 64,
    minLng: 1 / 64,
    maxLat: 2 / 64,
    maxLng: 2 / 64,
  }
];

// simplifyBoundaries で境界がまとめられるはずなので 1 つの Boundary で fetchOSM が呼ばれるはず
const QUERY_BOUNDARY: Boundary[] = [
  {
    minLat: 0 / 64,
    minLng: 1 / 64,
    maxLat: 2 / 64,
    maxLng: 2 / 64,
  }
];

const readCache = vi.fn().mockImplementation(async (bound: Boundary) => {
  for (const cached of CACHED_BOUNDARY) {
    if (cached.minLat === bound.minLat && cached.minLng === bound.minLng && cached.maxLat === bound.maxLat && cached.maxLng === bound.maxLng) {
      return { elements: [] };
    }
  }
  return null;
});
const saveCache = vi.fn();
const fetchOSM = vi.fn().mockImplementation(async _ => ({ elements: [] }));

/** テスト用のコンテキストを作る (tracing は無効なので DB に触れない) */
function context(): RequestContext {
  return new RequestContext(new Date(), "POST", "/test");
}

test("requireOSMData", async () => {
  const result = await requireOSMData(context(), BOUNDARY, { readCache, saveCache }, fetchOSM);
  expect(readCache).toHaveBeenCalledTimes(4);
  expect(readCache).toHaveBeenCalledWith(CACHED_BOUNDARY[0]);
  expect(readCache).toHaveBeenCalledWith(CACHED_BOUNDARY[1]);
  expect(readCache).toHaveBeenCalledWith(UNCACHED_BOUNDARY[0]);
  expect(readCache).toHaveBeenCalledWith(UNCACHED_BOUNDARY[1]);
  expect(saveCache).toHaveBeenCalledTimes(2);
  expect(saveCache).toHaveBeenCalledWith(UNCACHED_BOUNDARY[0], { elements: [] });
  expect(saveCache).toHaveBeenCalledWith(UNCACHED_BOUNDARY[1], { elements: [] });
  expect(fetchOSM).toHaveBeenCalledTimes(1);
  expect(fetchOSM).toHaveBeenCalledWith(QUERY_BOUNDARY);
  expect(result.partial).toBe(false);
  expect(result.reason).toBeUndefined();
});

test("readCache が reject しても cache スパンを記録する", async () => {
  const ctx = context();
  const failingReadCache = vi.fn().mockRejectedValue(new Error("boom"));

  await expect(
    requireOSMData(ctx, BOUNDARY, { readCache: failingReadCache, saveCache }, fetchOSM),
  ).rejects.toThrow("boom");

  expect(ctx.measuredEntries.some((entry) => entry.name === "cache")).toBe(true);
});

/** 時間予算で打ち切られた fetch の失敗 */
function timeoutError(): Error {
  return Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
}

test("時間予算で切れたらキャッシュ済みの分だけで続行する (#116)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const boundary: Boundary = { minLat: 0 / 64, minLng: 0 / 64, maxLat: 2 / 64, maxLng: 2 / 64 };
  const readCache = vi.fn().mockResolvedValue(null);
  const saveCache = vi.fn();
  const fetchOSM = vi.fn().mockRejectedValue(timeoutError());

  const result = await requireOSMData(context(), boundary, { readCache, saveCache }, fetchOSM);

  expect(result).toEqual({ data: { elements: [] }, partial: true, reason: "fetch-timeout" });
  expect(fetchOSM).toHaveBeenCalledTimes(1);
  expect(saveCache).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("時間予算以外の fetch 失敗は今までどおり投げる (#116)", async () => {
  const boundary: Boundary = { minLat: 0 / 64, minLng: 0 / 64, maxLat: 2 / 64, maxLng: 2 / 64 };
  const fetchOSM = vi.fn().mockRejectedValue(new Error("Overpass API エラー: 429"));

  await expect(
    requireOSMData(
      context(),
      boundary,
      { readCache: vi.fn().mockResolvedValue(null), saveCache: vi.fn() },
      fetchOSM,
    ),
  ).rejects.toThrow("429");
});

test("取得対象セルが上限を超えたら Overpass を叩かない (#117)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // 23x23 = 529 セル (上限 512 を超える)
  const boundary: Boundary = { minLat: 0, minLng: 0, maxLat: 23 / 64, maxLng: 23 / 64 };
  const readCache = vi.fn().mockResolvedValue(null);
  const saveCache = vi.fn();
  const fetchOSM = vi.fn();

  const result = await requireOSMData(context(), boundary, { readCache, saveCache }, fetchOSM);

  expect(fetchOSM).not.toHaveBeenCalled();
  expect(saveCache).not.toHaveBeenCalled();
  expect(result).toEqual({ data: { elements: [] }, partial: true, reason: "cell-limit" });
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("取得対象セルが上限以内なら Overpass を叩く (#117)", async () => {
  // 22x22 = 484 セル (上限 512 以内)
  const boundary: Boundary = { minLat: 0, minLng: 0, maxLat: 22 / 64, maxLng: 22 / 64 };
  const fetchOSM = vi.fn().mockResolvedValue({ elements: [] });

  await requireOSMData(
    context(),
    boundary,
    { readCache: vi.fn().mockResolvedValue(null), saveCache: vi.fn() },
    fetchOSM,
  );

  expect(fetchOSM).toHaveBeenCalledTimes(1);
});

test("同じ範囲の同時 fetch は 1 回にまとめる (#115)", async () => {
  const boundary: Boundary = { minLat: 0 / 64, minLng: 0 / 64, maxLat: 2 / 64, maxLng: 2 / 64 };
  let resolveFetch!: (data: App.OSMData) => void;
  const fetchOSM = vi.fn(() => new Promise<App.OSMData>((resolve) => { resolveFetch = resolve; }));
  const readCache = vi.fn().mockResolvedValue(null);
  const saveCache = vi.fn().mockResolvedValue(undefined);
  const cache = { readCache, saveCache };

  const first = requireOSMData(context(), boundary, cache, fetchOSM);
  const second = requireOSMData(context(), boundary, cache, fetchOSM);

  // 両方の呼び出しが fetch に到達するまで待つ (readCache の await を流す)
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchOSM).toHaveBeenCalledTimes(1);

  resolveFetch({ elements: [] });
  await Promise.all([first, second]);
  expect(readCache).toHaveBeenCalledTimes(8);
});
