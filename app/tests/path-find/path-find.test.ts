import { describe, expect, test, vi } from "vitest";

// 地図データの取得 (キャッシュ・Overpass) はモックし、テストごとに用意した地図を返す
let mapData: App.OSMData = { elements: [] };
vi.mock("../../src/routes/api/osm", () => ({ requireOSMData: vi.fn(async () => structuredClone(mapData)) }));
vi.mock("../../src/routes/api/osm/fs-cache-manager", () => ({ cacheManager: {} }));
vi.mock("../../src/routes/api/osm/osm-fetcher", () => ({ fetchOverpassData: vi.fn() }));

import { doPathFind, getBoundaryBox, MAX_SNAP_DISTANCE_M } from "../../src/routes/api/path-find/pathFind";
import { MODE_PROFILES } from "../../src/lib/mode_profiles";

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
});
