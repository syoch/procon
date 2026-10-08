import { expect, test, vi } from "vitest";
import type { Boundary } from "../../src/lib/osm/boundary";
import { divideBoundary, simplifyBoundaries } from "../../src/lib/osm/boundary";
import {
  DEFAULT_TTL_DAYS,
  refreshExpiredOSMCache,
  ttlMs,
  type CachedCell,
} from "../../src/lib/osm/expired-cache";
import { MAX_OSM_CELLS } from "../../src/lib/osm/limits";

const D = 1 / 64;
const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

/** 1/64 度格子のセルを作る (divideBoundary と同じ格子) */
function cell(latIndex: number, lngIndex: number): Boundary {
  return {
    minLat: 37 + latIndex * D,
    minLng: 138 + lngIndex * D,
    maxLat: 37 + (latIndex + 1) * D,
    maxLng: 138 + (lngIndex + 1) * D,
  };
}

/** 指定日数だけ古いセルを作る */
function cached(bound: Boundary, ageMs: number): CachedCell {
  return { bound, fetchedAt: NOW - ageMs };
}

/**
 * 指定したセルすべてにデータを含む OSMData を作る
 *
 * 実際の Overpass 応答と同じ「way + その参照先 node」の形にして、各セルの
 * 内側に節点と way を 1 本ずつ置く。trimOSMData は境界内の節点を参照する
 * way しか残さないので、way なしだと結果が空になってしまう。
 * なお生要素の座標フィールド名は `lon` (lng ではない)。
 */
function osmDataFor(cells: Boundary[]): App.OSMData {
  const elements: (App.OSMRawWay | App.OSMRawNode)[] = [];
  cells.forEach((b, k) => {
    const a = k * 2 + 1;
    const c = k * 2 + 2;
    elements.push({ type: "node", id: a, lat: b.minLat + 0.001, lon: b.minLng + 0.001 });
    elements.push({ type: "node", id: c, lat: b.maxLat - 0.001, lon: b.maxLng - 0.001 });
    elements.push({
      type: "way",
      id: 1000 + k,
      nodes: [a, c],
      tags: { highway: "residential" },
    });
  });
  return { elements };
}


test("ttlMs: 未設定・空文字なら既定日数", () => {
  expect(ttlMs(undefined)).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("   ")).toBe(DEFAULT_TTL_DAYS * DAY);
});

test("ttlMs: 明示的な 0 なら失効させない", () => {
  expect(ttlMs("0")).toBe(Infinity);
  expect(ttlMs("0.0")).toBe(Infinity);
});

test("ttlMs: 不正値は警告して既定値に倒す (更新が永久に止まらないように)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(ttlMs("abc")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("30日")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("-1")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(warn).toHaveBeenCalledTimes(3);
  warn.mockRestore();
});

test("ttlMs: 正の数値は日数として解釈する", () => {
  expect(ttlMs("1")).toBe(DAY);
  expect(ttlMs("7")).toBe(7 * DAY);
  expect(ttlMs("30.5")).toBe(30.5 * DAY);
});


test("TTL 内なら更新しない (Overpass に問い合わせない)", async () => {
  const fetchOSM = vi.fn();
  const saveCache = vi.fn();
  const result = await refreshExpiredOSMCache(
    async () => [cached(cell(0, 0), 1 * DAY), cached(cell(0, 1), 29 * DAY)],
    fetchOSM,
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.scanned).toBe(2);
  expect(result.expired).toBe(0);
  expect(fetchOSM).not.toHaveBeenCalled();
  expect(saveCache).not.toHaveBeenCalled();
});

test("TTL を超えたセルだけを更新する", async () => {
  const fresh = cell(0, 0);
  const stale = cell(1, 1);
  const fetchOSM = vi.fn().mockResolvedValue(osmDataFor([fresh, stale]));
  const saveCache = vi.fn().mockResolvedValue(undefined);

  const result = await refreshExpiredOSMCache(
    async () => [cached(fresh, 1 * DAY), cached(stale, 40 * DAY)],
    fetchOSM,
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.expired).toBe(1);
  expect(result.refreshed).toBe(1);
  expect(saveCache).toHaveBeenCalledTimes(1);
  expect(saveCache.mock.calls[0][0]).toEqual(stale);
});

test("境界ちょうどのセルは失効扱いにならない (TTL は > で判定)", async () => {
  const fetchOSM = vi.fn();
  const result = await refreshExpiredOSMCache(
    async () => [cached(cell(0, 0), 30 * DAY)],
    fetchOSM,
    vi.fn(),
    { now: NOW, ttlMs: 30 * DAY },
  );
  expect(result.expired).toBe(0);
  expect(fetchOSM).not.toHaveBeenCalled();
});


test("散在セルでも Overpass への問い合わせは 1 回", async () => {
  const scattered = [cell(0, 0), cell(3, 7), cell(11, 2), cell(20, 15), cell(5, 30)];
  const fetchOSM = vi.fn().mockResolvedValue(osmDataFor(scattered));

  const result = await refreshExpiredOSMCache(
    async () => scattered.map((b) => cached(b, 40 * DAY)),
    fetchOSM,
    vi.fn().mockResolvedValue(undefined),
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(fetchOSM).toHaveBeenCalledTimes(1);
  expect(fetchOSM.mock.calls[0][0]).toHaveLength(5);
  expect(result.regions).toBe(5);
  expect(result.refreshed).toBe(5);
});

test("隣接した 4x4 ブロックは 1 矩形にまとめられ、1 回の問い合わせになる", async () => {
  const block = divideBoundary({
    minLat: 37,
    minLng: 138,
    maxLat: 37 + 4 * D,
    maxLng: 138 + 4 * D,
  });
  expect(block).toHaveLength(16);
  expect(simplifyBoundaries(block)).toHaveLength(1);

  const fetchOSM = vi.fn().mockResolvedValue(osmDataFor(block));
  const result = await refreshExpiredOSMCache(
    async () => block.map((b) => cached(b, 40 * DAY)),
    fetchOSM,
    vi.fn().mockResolvedValue(undefined),
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(fetchOSM).toHaveBeenCalledTimes(1);
  expect(fetchOSM.mock.calls[0][0]).toHaveLength(1);
  expect(result.regions).toBe(1);
  expect(result.refreshed).toBe(16);
});


test("取得に失敗しても例外を投げず、全セルを failed に数える", async () => {
  const fetchOSM = vi.fn().mockRejectedValue(new Error("Overpass API エラー: 429"));
  const saveCache = vi.fn();

  const result = await refreshExpiredOSMCache(
    async () => [cell(0, 0), cell(1, 1)].map((b) => cached(b, 40 * DAY)),
    fetchOSM,
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.expired).toBe(2);
  expect(result.failed).toBe(2);
  expect(result.refreshed).toBe(0);
  expect(saveCache).not.toHaveBeenCalled();
});

test("空の結果も保存する (その領域に道が無いのは正当な状態)", async () => {
  // 保存しないと mtime が解けず、毎晩同じセルを pulled し続ける。取得自体が
  // 壊れている場合は fetchOSM の remark 検査で失敗として扱われるのでここでは区別しなくてよい
  const cells = [cell(0, 0), cell(5, 5)];
  const saveCache = vi.fn().mockResolvedValue(undefined);

  const result = await refreshExpiredOSMCache(
    async () => cells.map((b) => cached(b, 40 * DAY)),
    vi.fn().mockResolvedValue({ elements: [] } as App.OSMData),
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(saveCache).toHaveBeenCalledTimes(2);
  expect(saveCache.mock.calls[0][1]).toEqual({ elements: [] });
  expect(result.refreshed).toBe(2);
  expect(result.failed).toBe(0);
});

test("1 セルの保存に失敗しても他のセルは保存される", async () => {
  const good = cell(0, 0);
  const bad = cell(5, 5);
  const saveCache = vi.fn().mockImplementation(async (b: Boundary) => {
    if (b === bad) throw new Error("書き込み失敗");
  });

  const result = await refreshExpiredOSMCache(
    async () => [good, bad].map((b) => cached(b, 40 * DAY)),
    vi.fn().mockResolvedValue(osmDataFor([good, bad])),
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.refreshed).toBe(1);
  expect(result.failed).toBe(1);
  expect(saveCache).toHaveBeenCalledWith(good, expect.anything());
});

test("キャッシュが空でも例外にならない", async () => {
  const fetchOSM = vi.fn();
  const result = await refreshExpiredOSMCache(async () => [], fetchOSM, vi.fn(), {
    now: NOW,
    ttlMs: 30 * DAY,
  });
  expect(result).toEqual({
    scanned: 0,
    expired: 0,
    refreshed: 0,
    failed: 0,
    regions: 0,
    deferred: 0,
  });
  expect(fetchOSM).not.toHaveBeenCalled();
});


test("古いものから順に処理する", async () => {
  const oldest = cell(0, 0);
  const newest = cell(9, 9);
  const order: Boundary[] = [];

  await refreshExpiredOSMCache(
    async () => [cached(newest, 31 * DAY), cached(oldest, 100 * DAY)],
    vi.fn().mockResolvedValue(osmDataFor([oldest, newest])),
    vi.fn().mockImplementation(async (b: Boundary) => {
      order.push(b);
    }),
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(order).toEqual([oldest, newest]);
});


test("取得応答の形が違う場合は全セルを failed にする (例外が関数全体を抜けない)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchOSM = vi.fn().mockResolvedValue({ remark: "runtime error" } as unknown as App.OSMData);
  const saveCache = vi.fn();

  const result = await refreshExpiredOSMCache(
    async () => [cell(0, 0), cell(1, 1)].map((b) => cached(b, 40 * DAY)),
    fetchOSM,
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.failed).toBe(2);
  expect(result.refreshed).toBe(0);
  expect(saveCache).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("クエリ領域に含まれないセルは failed に数える (黙って捨てない)", async () => {
  // simplifyBoundaries は入力を内包するので、1 マスより大きいセルだけが外れる
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const oversized: Boundary = { minLat: 0, minLng: 0, maxLat: 0.05, maxLng: 0.001 };
  const onGrid = cell(0, 0);

  const result = await refreshExpiredOSMCache(
    async () => [cached(oversized, 40 * DAY), cached(onGrid, 40 * DAY)],
    vi.fn().mockResolvedValue(osmDataFor([onGrid])),
    vi.fn().mockResolvedValue(undefined),
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.failed).toBe(1);
  expect(result.refreshed).toBe(1);
  expect(result.expired).toBe(result.refreshed + result.failed);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

test("1x1 格子に載ったセルは simplifyBoundaries の矩形に必ず含まれる", async () => {
  // fixture も divideBoundary で作る（手書きの座標は格子境界をまたぎ得る）
  const cells = [
    ...divideBoundary({ minLat: 37, minLng: 138, maxLat: 37 + 2 * D, maxLng: 138 + D }),
    ...divideBoundary({ minLat: 40.6, minLng: -73.9, maxLat: 40.6 + D, maxLng: -73.9 + D }),
    ...divideBoundary({ minLat: 0, minLng: 0, maxLat: D, maxLng: D }),
  ];
  expect(cells.length).toBeGreaterThan(0);
  const rects = simplifyBoundaries(cells);
  const covered = (c: Boundary, query: Boundary) =>
    c.minLat >= query.minLat && c.maxLat <= query.maxLat
    && c.minLng >= query.minLng && c.maxLng <= query.maxLng;
  for (const c of cells) {
    expect(rects.some((r) => covered(c, r))).toBe(true);
  }
});

test("ttlMs: -0 は「意図した 0」扱いにしない", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(ttlMs("-0")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("-0.0")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("0")).toBe(Infinity);
  warn.mockRestore();
});

test("ttlMs: Infinity や NaN 文字列は既定値に倒す", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(ttlMs("Infinity")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("NaN")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("1e400")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("0abc")).toBe(DEFAULT_TTL_DAYS * DAY);
  warn.mockRestore();
});

test("2 回続けて走らせると 2 回目は expired: 0 で Overpass に問い合わせない", async () => {
  const fetchOSM = vi.fn().mockResolvedValue(osmDataFor([cell(0, 0)]));
  const listCached = async () => [cached(cell(0, 0), 40 * DAY)];

  const first = await refreshExpiredOSMCache(listCached, fetchOSM, vi.fn(), {
    now: NOW,
    ttlMs: 30 * DAY,
  });
  expect(first.expired).toBe(1);
  expect(fetchOSM).toHaveBeenCalledTimes(1);

  // 保存後は mtime が更新されるので、次回は更新対象にならない
  const afterSave = Date.now();
  const second = await refreshExpiredOSMCache(
    async () => [{ bound: cell(0, 0), fetchedAt: afterSave }],
    fetchOSM,
    vi.fn(),
    { now: afterSave, ttlMs: 30 * DAY },
  );
  expect(second.expired).toBe(0);
  expect(fetchOSM).toHaveBeenCalledTimes(1);
});




test("ttlMs: 日数の積がオーバーフローしたら既定値に倒す (警告なしで Infinity にしない)", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(ttlMs("1e301")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(ttlMs("1e308")).toBe(DEFAULT_TTL_DAYS * DAY);
  expect(warn).toHaveBeenCalledTimes(2);
  expect(ttlMs("365")).toBe(365 * DAY);
  warn.mockRestore();
});




test("取得応答の要素が壊れていれば全セルを failed にする (走査全体が TypeError で中断しない)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const broken = { elements: [{ type: "way", id: 1 }] } as unknown as App.OSMData;
  const saveCache = vi.fn();

  const result = await refreshExpiredOSMCache(
    async () => [cell(0, 0), cell(1, 1)].map((b) => cached(b, 40 * DAY)),
    async () => broken,
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.failed).toBe(2);
  expect(saveCache).not.toHaveBeenCalled();
  warn.mockRestore();
});

test("取得応答の要素が null 混在でも走査全体が落ちない", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const result = await refreshExpiredOSMCache(
    async () => [cell(0, 0)].map((b) => cached(b, 40 * DAY)),
    async () => ({ elements: [null] }) as unknown as App.OSMData,
    vi.fn().mockResolvedValue(undefined),
    { now: NOW, ttlMs: 30 * DAY },
  );
  expect(result.failed).toBe(1);
  warn.mockRestore();
});


test("1 回に処理する失効セルは上限までで、残りは次回に回す (#117)", async () => {
  const all = Array.from({ length: MAX_OSM_CELLS + 1 }, (_, i) => cell(0, i));
  const fetchOSM = vi.fn().mockResolvedValue(osmDataFor(all));
  const saveCache = vi.fn().mockResolvedValue(undefined);

  const result = await refreshExpiredOSMCache(
    async () => all.map((b) => cached(b, 40 * DAY)),
    fetchOSM,
    saveCache,
    { now: NOW, ttlMs: 30 * DAY },
  );

  expect(result.expired).toBe(MAX_OSM_CELLS + 1);
  expect(result.deferred).toBe(1);
  expect(result.refreshed).toBe(MAX_OSM_CELLS);
  expect(saveCache).toHaveBeenCalledTimes(MAX_OSM_CELLS);
  expect(fetchOSM).toHaveBeenCalledTimes(1);
});


