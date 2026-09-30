import { describe, expect, test, vi } from "vitest";

// 地図データの取得 (キャッシュ・Overpass) はモックし、テストごとに用意した地図を返す
let mapData: App.OSMData = { elements: [] };
vi.mock("../../src/routes/api/osm", () => ({ requireOSMData: vi.fn(async () => structuredClone(mapData)) }));
vi.mock("../../src/routes/api/osm/fs-cache-manager", () => ({ cacheManager: {} }));
vi.mock("../../src/routes/api/osm/osm-fetcher", () => ({ fetchOverpassData: vi.fn() }));
// 国土地理院の幅員も同様にモックし、テストごとに用意した区間を返す
let gsiSegments: GsiRoadSegment[] = [];
vi.mock("../../src/routes/api/gsi", () => ({ requireGsiRoadSegments: vi.fn(async () => gsiSegments) }));
vi.mock("../../src/routes/api/gsi/fs-cache-manager", () => ({ gsiCacheManager: {} }));
vi.mock("../../src/routes/api/gsi/gsi-fetcher", () => ({ fetchGsiRoadTile: vi.fn() }));

import { doPathFind, getBoundaryBox, MAX_SNAP_DISTANCE_M } from "../../src/routes/api/path-find/pathFind";
import { MODE_PROFILES } from "../../src/lib/mode_profiles";
import type { GsiRoadSegment } from "../../src/lib/road_width";

const CELL = 0.015625;
const node = (id: number, lat: number, lon: number): App.OSMRawNode => ({ type: "node", id, lat, lon });
const car = MODE_PROFILES.car.defaultParameters;

describe("getBoundaryBox", () => {
  test("始点・終点を含む格子の周りに 1 マス分の余白を足す", () => {
    const begin = { lat: 37.448, lng: 138.853 }, end = { lat: 37.441, lng: 138.868 };
    const box = getBoundaryBox(begin, end);
    for (const p of [begin, end]) {
      expect(p.lat - box.minLat).toBeGreaterThanOrEqual(CELL);
      expect(box.maxLat - p.lat).toBeGreaterThanOrEqual(CELL);
      expect(p.lng - box.minLng).toBeGreaterThanOrEqual(CELL);
      expect(box.maxLng - p.lng).toBeGreaterThanOrEqual(CELL);
    }
  });
});

describe("doPathFind: 到達できない場合のエラー", () => {
  // 東西に走る道 (lat 0) と、そこから 1km 北にある孤立した短い道
  const baseMap = (): App.OSMData => ({
    elements: [
      { type: "way", id: 1, nodes: [1, 2, 3], tags: { highway: "residential" } },
      { type: "way", id: 2, nodes: [10, 11], tags: { highway: "residential" } },
      node(1, 0, 0), node(2, 0, 0.005), node(3, 0, 0.01),
      node(10, 0.009, 0.004), node(11, 0.009, 0.006),
    ],
  });

  test("道のすぐ近くなら経路が出て、吸着のずれも返す", async () => {
    mapData = baseMap();
    const res = await doPathFind({ lat: 0.0001, lng: 0.001 }, { lat: 0.0001, lng: 0.009 }, car, [], "car");
    if (!res.found) throw new Error(res.message);
    expect(res.coords.length).toBeGreaterThan(0);
    expect(res.snapDistance.begin).toBeLessThan(20);
    expect(res.snapDistance.end).toBeLessThan(20);
  });

  test("目的地が道路網から切り離された道の上なら、遠くの道に黙って吸着せず「到達できない」を返す", async () => {
    mapData = baseMap();
    // 終点は孤立した道 (lat 0.009) の上。最大の道路網 (lat 0) までは約 1km
    const res = await doPathFind({ lat: 0, lng: 0.001 }, { lat: 0.009, lng: 0.005 }, car, [], "car");
    expect(res).toMatchObject({ found: false, reason: "END_UNREACHABLE" });
  });

  test(`出発地の ${MAX_SNAP_DISTANCE_M}m 以内に通れる道が無ければ「到達できない」を返す`, async () => {
    mapData = baseMap();
    const res = await doPathFind({ lat: -0.005, lng: 0.005 }, { lat: 0, lng: 0.009 }, car, [], "car");
    expect(res).toMatchObject({ found: false, reason: "BEGIN_UNREACHABLE" });
  });

  test("一方通行などでたどり着けないときは「経路が見つからない」を返す", async () => {
    mapData = {
      elements: [
        { type: "way", id: 1, nodes: [1, 2, 3], tags: { highway: "residential", oneway: "yes" } },
        node(1, 0, 0), node(2, 0, 0.005), node(3, 0, 0.01),
      ],
    };
    // 一方通行 (西 → 東) を東から西へ向かう
    const res = await doPathFind({ lat: 0, lng: 0.009 }, { lat: 0, lng: 0.001 }, car, [], "car");
    expect(res).toMatchObject({ found: false, reason: "NO_ROUTE" });
  });

  test("自転車は oneway:bicycle=no の一方通行を逆向きに通れる (車は通れない)", async () => {
    mapData = {
      elements: [
        { type: "way", id: 1, nodes: [1, 2, 3], tags: { highway: "residential", oneway: "yes", "oneway:bicycle": "no" } },
        node(1, 0, 0), node(2, 0, 0.005), node(3, 0, 0.01),
      ],
    };
    const bicycle = MODE_PROFILES.bicycle.defaultParameters;
    expect(await doPathFind({ lat: 0, lng: 0.009 }, { lat: 0, lng: 0.001 }, bicycle, [], "bicycle")).toMatchObject({ found: true });
    expect(await doPathFind({ lat: 0, lng: 0.009 }, { lat: 0, lng: 0.001 }, car, [], "car")).toMatchObject({ found: false });
  });

  test("車は舗装された track の先にある目的地 (展望台など) にも行ける", async () => {
    mapData = {
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "tertiary" } },
        { type: "way", id: 2, nodes: [2, 3], tags: { highway: "track", tracktype: "grade1" } },
        node(1, 0, 0), node(2, 0, 0.005), node(3, 0.004, 0.009),
      ],
    };
    const res = await doPathFind({ lat: 0, lng: 0.001 }, { lat: 0.004, lng: 0.009 }, car, [], "car");
    expect(res).toMatchObject({ found: true });
  });

  test("車は割高な service を抜け道に使わず、遠回りでも一般道を通る (徒歩は近い方を通る)", async () => {
    // A (0,0) → B (0,0.01) を結ぶ service (約 1.1km) と、北に膨らむ residential (約 1.2km)
    mapData = {
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "service" } },
        { type: "way", id: 2, nodes: [1, 3, 2], tags: { highway: "residential" } },
        { type: "way", id: 3, nodes: [4, 1], tags: { highway: "residential" } },
        { type: "way", id: 4, nodes: [2, 5], tags: { highway: "residential" } },
        node(1, 0, 0), node(2, 0, 0.01), node(3, 0.002, 0.005), node(4, 0, -0.002), node(5, 0, 0.012),
      ],
    };
    const maxLat = (res: Awaited<ReturnType<typeof doPathFind>>) =>
      res.found ? Math.max(...res.coords.map((c) => c.lat)) : NaN;
    const begin = { lat: 0, lng: -0.0015 }, end = { lat: 0, lng: 0.0115 };
    expect(maxLat(await doPathFind(begin, end, car, [], "car"))).toBeGreaterThan(0.0019);
    expect(maxLat(await doPathFind(begin, end, MODE_PROFILES.walk.defaultParameters, [], "walk"))).toBeLessThan(0.0001);
  });

  describe("国土地理院の幅員", () => {
    // 西 (0,0) と東 (0,0.01) を結ぶ 2 本の道: 直進の residential と、北に膨らむ tertiary
    const twoRoads = (): App.OSMData => ({
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential" } },
        { type: "way", id: 2, nodes: [1, 3, 2], tags: { highway: "tertiary" } },
        { type: "way", id: 3, nodes: [4, 1], tags: { highway: "tertiary" } },
        { type: "way", id: 4, nodes: [2, 5], tags: { highway: "tertiary" } },
        node(1, 0, 0), node(2, 0, 0.01), node(3, 0.003, 0.005), node(4, 0, -0.002), node(5, 0, 0.012),
      ],
    });
    const maxLat = (res: Awaited<ReturnType<typeof doPathFind>>) =>
      res.found ? Math.max(...res.coords.map((c) => c.lat)) : NaN;
    const begin = { lat: 0, lng: -0.0015 }, end = { lat: 0, lng: 0.0115 };
    const truck = MODE_PROFILES.truck.defaultParameters;

    test("大型トラックは幅 5.5m 未満の対面通行の道を通らない (車は通る)", async () => {
      mapData = twoRoads();
      // 直進の residential は 3m-5.5m (代表値 4m)
      gsiSegments = [{ begin: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.01 }, width: 4 }];
      expect(maxLat(await doPathFind(begin, end, truck, [], "truck"))).toBeGreaterThan(0.0029);
      expect(maxLat(await doPathFind(begin, end, car, [], "car"))).toBeLessThan(0.0001);
    });

    test("幅が十分なら大型トラックも通る", async () => {
      mapData = twoRoads();
      gsiSegments = [{ begin: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.01 }, width: 8 }];
      expect(maxLat(await doPathFind(begin, end, truck, [], "truck"))).toBeLessThan(0.0001);
    });

    test("幅が分かった service には割高の倍率を掛けない", async () => {
      // 前のテストと同じ地図で、service を幅 8m (5.5m-13m) とすると車も service を通る
      mapData = {
        elements: [
          { type: "way", id: 1, nodes: [1, 2], tags: { highway: "service" } },
          { type: "way", id: 2, nodes: [1, 3, 2], tags: { highway: "residential" } },
          { type: "way", id: 3, nodes: [4, 1], tags: { highway: "residential" } },
          { type: "way", id: 4, nodes: [2, 5], tags: { highway: "residential" } },
          node(1, 0, 0), node(2, 0, 0.01), node(3, 0.002, 0.005), node(4, 0, -0.002), node(5, 0, 0.012),
        ],
      };
      gsiSegments = [{ begin: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.01 }, width: 8 }];
      expect(maxLat(await doPathFind(begin, end, car, [], "car"))).toBeLessThan(0.0001);
      gsiSegments = [];
    });
  });
});

