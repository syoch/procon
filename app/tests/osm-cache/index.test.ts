import { afterEach, expect, test, vi } from "vitest";
import type { Boundary } from "../../src/lib/osm/boundary";
import { requireOSMData } from "../../src/lib/osm";
import { RequestContext } from "$lib/tracing/requestContext";

afterEach(() => {
  vi.useRealTimers();
});

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
  await requireOSMData(context(), BOUNDARY, { readCache, saveCache }, fetchOSM);
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
});

test("readCache が reject しても cache スパンを記録する", async () => {
  const ctx = context();
  const failingReadCache = vi.fn().mockRejectedValue(new Error("boom"));

  await expect(
    requireOSMData(ctx, BOUNDARY, { readCache: failingReadCache, saveCache }, fetchOSM),
  ).rejects.toThrow("boom");

  expect(ctx.measuredEntries.some((entry) => entry.name === "cache")).toBe(true);
});

test("fetch の失敗は throw する", async () => {
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

test("取得対象セルが上限を超えたら throw する (#117)", async () => {
  // 23x23 = 529 セル (上限 512 を超える)
  const boundary: Boundary = { minLat: 0, minLng: 0, maxLat: 23 / 64, maxLng: 23 / 64 };
  const readCache = vi.fn().mockResolvedValue(null);
  const saveCache = vi.fn();
  const fetchOSM = vi.fn();

  await expect(
    requireOSMData(context(), boundary, { readCache, saveCache }, fetchOSM),
  ).rejects.toThrow("OSM の取得対象セルが 529 枚で上限 512 枚を超えています");

  expect(fetchOSM).not.toHaveBeenCalled();
  expect(saveCache).not.toHaveBeenCalled();
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
  // preload-osm と path-find が同じ無効キャッシュ領域を同時に取得する状況を模す
  const boundary: Boundary = { minLat: 0 / 64, minLng: 0 / 64, maxLat: 2 / 64, maxLng: 2 / 64 };
  let resolveFetch!: (data: App.OSMData) => void;
  const fetchOSM = vi.fn(() => new Promise<App.OSMData>((resolve) => { resolveFetch = resolve; }));
  const readCache = vi.fn().mockResolvedValue(null);
  const saveCache = vi.fn().mockResolvedValue(undefined);
  const cache = { readCache, saveCache };

  const preload = requireOSMData(context(), boundary, cache, fetchOSM, true);
  const pathFind = requireOSMData(context(), boundary, cache, fetchOSM);

  // 両方の呼び出しが fetch に到達するまで待つ (readCache の await を流す)
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchOSM).toHaveBeenCalledTimes(1);

  resolveFetch({ elements: [] });
  await Promise.all([preload, pathFind]);
  expect(readCache).toHaveBeenCalledTimes(8);
});

test("進行中の取得が覆うセルは再 fetch しない (#117)", async () => {
  const outer: Boundary = { minLat: 0, minLng: 0, maxLat: 2 / 64, maxLng: 2 / 64 };
  const inner: Boundary = { minLat: 0, minLng: 0, maxLat: 1 / 64, maxLng: 1 / 64 };
  let resolveFetch!: (data: App.OSMData) => void;
  const fetchOSM = vi.fn(() => new Promise<App.OSMData>((resolve) => { resolveFetch = resolve; }));
  const cache = { readCache: vi.fn().mockResolvedValue(null), saveCache: vi.fn().mockResolvedValue(undefined) };

  const outerRun = requireOSMData(context(), outer, cache, fetchOSM);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchOSM).toHaveBeenCalledTimes(1);

  // inner のセルは outer の進行中の取得が覆うので join する
  const innerRun = requireOSMData(context(), inner, cache, fetchOSM);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(fetchOSM).toHaveBeenCalledTimes(1);

  resolveFetch({ elements: [] });
  await Promise.all([outerRun, innerRun]);
});

test("重なる範囲でも重複セルは 1 回しか fetch しない (#117)", async () => {
  // lat: セル (0,0) と (1,0)、lng: セル (0,0) と (0,1) で (0,0) だけ重なる
  const lat: Boundary = { minLat: 0, minLng: 0, maxLat: 2 / 64, maxLng: 1 / 64 };
  const lng: Boundary = { minLat: 0, minLng: 0, maxLat: 1 / 64, maxLng: 2 / 64 };
  const resolvers: ((data: App.OSMData) => void)[] = [];
  const fetchOSM = vi.fn((_boundaries: Boundary[]) => new Promise<App.OSMData>((resolve) => { resolvers.push(resolve); }));
  const cache = { readCache: vi.fn().mockResolvedValue(null), saveCache: vi.fn().mockResolvedValue(undefined) };

  const first = requireOSMData(context(), lat, cache, fetchOSM);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = requireOSMData(context(), lng, cache, fetchOSM);
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(fetchOSM).toHaveBeenCalledTimes(2);
  // 2 回目は重複する (0,0) を除き、(0,1) だけを要求する
  expect(fetchOSM.mock.calls[1][0]).toEqual([
    { minLat: 0, minLng: 1 / 64, maxLat: 1 / 64, maxLng: 2 / 64 },
  ]);

  resolvers.forEach((resolve) => resolve({ elements: [] }));
  await Promise.all([first, second]);
});

test("fetch が応答しなくても in-flight entry を TTL で解放する", async () => {
  vi.useFakeTimers();
  // 他のテストと重ならない境界を使う
  const boundary: Boundary = { minLat: 50, minLng: 50, maxLat: 50 + 2 / 64, maxLng: 50 + 2 / 64 };
  const fetchOSM = vi.fn(() => new Promise<App.OSMData>(() => { /* 応答しない */ }));
  const cache = { readCache: vi.fn().mockResolvedValue(null), saveCache: vi.fn().mockResolvedValue(undefined) };

  void requireOSMData(context(), boundary, cache, fetchOSM);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchOSM).toHaveBeenCalledTimes(1);

  // TTL を過ぎると entry が外れ、次の要求は新しい fetch を始める
  await vi.advanceTimersByTimeAsync(60_000);
  void requireOSMData(context(), boundary, cache, fetchOSM);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchOSM).toHaveBeenCalledTimes(2);

  // 2 つ目の entry も解放する
  await vi.advanceTimersByTimeAsync(60_000);
});
