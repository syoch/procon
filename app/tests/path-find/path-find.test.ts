import { describe, expect, test, vi, it } from "vitest";

// 地図データの取得 (キャッシュ・Overpass) はモックし、テストごとに用意した地図を返す
let mapData: App.OSMData = { elements: [] };
vi.mock("../../src/lib/osm", () => ({ requireOSMData: vi.fn(async () => structuredClone(mapData)) }));
vi.mock("../../src/lib/osm/fs-cache-manager", () => ({ cacheManager: {} }));
vi.mock("../../src/lib/osm/osm-fetcher", () => ({ overpassFetcher: vi.fn() }));
// 国土地理院の幅員も同様にモックし、テストごとに用意した区間を返す
let gsiSegments: GsiRoadSegment[] = [];
// (タイルの選び方 (tilesAlongPath など) は本物を使い、取得だけを差し替える。requestedTiles に要求されたタイルを記録する)
let requestedTiles: { x: number; y: number }[][] = [];
vi.mock("../../src/lib/gsi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/gsi")>()),
  requireGsiRoadSegmentsForTiles: vi.fn(async (tiles: { x: number; y: number }[]) => {
    requestedTiles.push(tiles);
    return gsiSegments;
  }),
}));
vi.mock("../../src/lib/gsi/fs-cache-manager", () => ({ gsiCacheManager: {} }));
vi.mock("../../src/lib/gsi/gsi-fetcher", () => ({ fetchGsiRoadTile: vi.fn() }));

import { doPathFind, MAX_SNAP_DISTANCE_M } from "../../src/routes/api/path-find/pathFind";
import { getBoundaryBox } from "../../src/lib/osm/path-boundary";
import { tilesAlongPath, tilesForBoundary } from "../../src/lib/gsi";
import { MODE_PROFILES } from "../../src/lib/mode_profiles";
import type { GsiRoadSegment } from "../../src/lib/gsi/parse";
import { RequestContext } from "$lib/tracing/requestContext";

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
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), { lat: 0.0001, lng: 0.001 }, { lat: 0.0001, lng: 0.009 }, car, [], "car");
    if (!res.found) throw new Error(res.message);
    expect(res.coords.length).toBeGreaterThan(0);
    expect(res.snapDistance.begin).toBeLessThan(20);
    expect(res.snapDistance.end).toBeLessThan(20);
  });

  test("目的地が道路網から切り離された道の上なら、遠くの道に黙って吸着せず「到達できない」を返す", async () => {
    mapData = baseMap();
    // 終点は孤立した道 (lat 0.009) の上。最大の道路網 (lat 0) までは約 1km
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), { lat: 0, lng: 0.001 }, { lat: 0.009, lng: 0.005 }, car, [], "car");
    expect(res).toMatchObject({ found: false, reason: "END_UNREACHABLE" });
  });

  test(`出発地の ${MAX_SNAP_DISTANCE_M}m 以内に通れる道が無ければ「到達できない」を返す`, async () => {
    mapData = baseMap();
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), { lat: -0.005, lng: 0.005 }, { lat: 0, lng: 0.009 }, car, [], "car");
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
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), { lat: 0, lng: 0.009 }, { lat: 0, lng: 0.001 }, car, [], "car");
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
    expect(await doPathFind(new RequestContext(new Date(), "POST", "/test"), { lat: 0, lng: 0.009 }, { lat: 0, lng: 0.001 }, bicycle, [], "bicycle")).toMatchObject({ found: true });
    expect(await doPathFind(new RequestContext(new Date(), "POST", "/test"), { lat: 0, lng: 0.009 }, { lat: 0, lng: 0.001 }, car, [], "car")).toMatchObject({ found: false });
  });

  test("車は舗装された track の先にある目的地 (展望台など) にも行ける", async () => {
    mapData = {
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "tertiary" } },
        { type: "way", id: 2, nodes: [2, 3], tags: { highway: "track", tracktype: "grade1" } },
        node(1, 0, 0), node(2, 0, 0.005), node(3, 0.004, 0.009),
      ],
    };
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), { lat: 0, lng: 0.001 }, { lat: 0.004, lng: 0.009 }, car, [], "car");
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
    expect(maxLat(await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, car, [], "car"))).toBeGreaterThan(0.0019);
    expect(maxLat(await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, MODE_PROFILES.walk.defaultParameters, [], "walk"))).toBeLessThan(0.0001);
  });

  describe("国土地理院の幅員", () => {
    // 西 (0,0) と東 (0,0.01) を結ぶ 2 本の道: 直進の residential と、北に膨らむ tertiary
    // 直進の residential と、北へ回り道する residential (どちらも幅が分からなければ中央線なし = 30 km/h で、速さは同じ)
    const twoRoads = (): App.OSMData => ({
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential" } },
        { type: "way", id: 2, nodes: [1, 3, 2], tags: { highway: "residential" } },
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
      expect(maxLat(await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, truck, [], "truck"))).toBeGreaterThan(0.0029);
      expect(maxLat(await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, car, [], "car"))).toBeLessThan(0.0001);
    });

    test("幅が十分なら大型トラックも通る", async () => {
      mapData = twoRoads();
      gsiSegments = [{ begin: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.01 }, width: 8 }];
      expect(maxLat(await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, truck, [], "truck"))).toBeLessThan(0.0001);
    });

    test("幅員の網羅率を応答に含める (国土地理院のデータが無ければ 0)", async () => {
      mapData = twoRoads();
      gsiSegments = [{ begin: { lat: 0, lng: 0 }, end: { lat: 0, lng: 0.01 }, width: 8 }];
      const withGsi = await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, truck, [], "truck");
      expect(withGsi.found && withGsi.widthCoverage.known).toBe(1);
      expect(withGsi.found && withGsi.widthCoverage.ratio).toBeGreaterThan(0);

      gsiSegments = [];
      const withoutGsi = await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, truck, [], "truck");
      expect(withoutGsi.found && withoutGsi.widthCoverage.ratio).toBe(0);
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
      expect(maxLat(await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, car, [], "car"))).toBeLessThan(0.0001);
      gsiSegments = [];
    });
  });
});

describe("doPathFind: 国土地理院のタイルは経路の周りだけ使う", () => {
  // 東西にまっすぐ約 5.5km の道 (タイル 1 枚は約 0.0055°)
  const longRoad = (): App.OSMData => ({
    elements: [
      { type: "way", id: 1, nodes: [1, 2, 3, 4, 5, 6], tags: { highway: "residential" } },
      ...[0, 0.01, 0.02, 0.03, 0.04, 0.05].map((lng, i) => node(i + 1, 0, lng)),
    ],
  });
  const begin = { lat: 0, lng: 0 }, end = { lat: 0, lng: 0.05 };

  test("1 回目は始点・終点の周り、2 回目は経路の周りのタイルで探索し、経路が変わらなければそこで終わる", async () => {
    mapData = longRoad();
    gsiSegments = [];
    requestedTiles = [];
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, car, [], "car");
    expect(res.found).toBe(true);
    expect(requestedTiles).toHaveLength(2);

    const middle = tilesAlongPath([{ lat: 0, lng: 0.025 }], 0)[0];
    const has = (tiles: { x: number; y: number }[], t: { x: number; y: number }) => tiles.some((u) => u.x === t.x && u.y === t.y);
    // 1 回目は始点・終点の周り (3×3 枚ずつ) だけで、途中のタイルは含まない
    expect(requestedTiles[0]).toHaveLength(18);
    expect(has(requestedTiles[0], middle)).toBe(false);
    // 2 回目は経路の途中のタイルも含む
    expect(has(requestedTiles[1], middle)).toBe(true);
  });

  test("経路の周りのタイル数は、探索範囲全体より少ない", async () => {
    mapData = longRoad();
    gsiSegments = [];
    requestedTiles = [];
    await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, car, [], "car");
    const all = tilesForBoundary(getBoundaryBox(begin, end));
    expect(requestedTiles[requestedTiles.length - 1].length).toBeLessThan(all.length);
  });
});

describe("doPathFind: 所要時間", () => {
  // 東西にまっすぐ約 1.1km の住宅地の道 (幅不明 = 中央線なし = 30 km/h)
  const road = (): App.OSMData => ({
    elements: [
      { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential" } },
      node(1, 0, 0), node(2, 0, 0.01),
    ],
  });
  const begin = { lat: 0, lng: 0 }, end = { lat: 0, lng: 0.01 };

  test("mode 指定時は想定速度から所要時間 [秒] を返す", async () => {
    mapData = road();
    gsiSegments = [];
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, car, [], "car");
    expect(res.found).toBe(true);
    if (!res.found) return;
    // 約 1112m を 30 km/h で約 133 秒
    expect(res.totalTime).toBeGreaterThan(125);
    expect(res.totalTime).toBeLessThan(140);
  });
  test("mode なし (従来の形式) は null", async () => {
    mapData = road();
    gsiSegments = [];
    const res = await doPathFind(new RequestContext(new Date(), "POST", "/test"), begin, end, car, ["residential"]);
    expect(res.found && res.totalTime).toBeNull();
  });
});

import {getCrossingRoadName} from "../../src/routes/api/path-find/pathFind";
describe('getCrossingRoadName', () => {
    
    /**
     * テスト用の交差点データを生成するヘルパー関数
     * 南から進入し、南北に「本通り」、東西に「クロス通り」が走っている十字路をモック化
     * 
     * @param straightIsFirst trueの場合、わざと配列の先頭に「直進（本通り）」が来るように悪意のある並びにする
     */
    function createMockMapData(straightIsFirst: boolean): any {
        return {
            nodes: {
                node_s: { // 進入ノード (南)
                    id: 'node_s',
                    type: 'MapVCrossNode',
                    // 直進(n)のデータが配列の先頭に来るパターンと、来ないパターンを切り替える
                    edges: straightIsFirst 
                        ? ['edge_s_to_n', 'edge_s_to_w', 'edge_s_to_e', 'road_s']
                        : ['edge_s_to_w', 'edge_s_to_n', 'edge_s_to_e', 'road_s']
                },
                node_n: { id: 'node_n', type: 'MapVCrossNode', edges: ['road_n'] }, // 直進先
                node_e: { id: 'node_e', type: 'MapVCrossNode', edges: ['road_e'] }, // 右折先
                node_w: { id: 'node_w', type: 'MapVCrossNode', edges: ['road_w'] }  // 左折先
            },
            edges: {
                // 外部の道路（交差点の外の道）
                road_s: {
                    id: 'road_s', type: 'NormalEdge', begin: 'out_s', end: 'node_s',
                    segments: [{ tags: { name: '本通り' } }]
                },
                road_n: {
                    id: 'road_n', type: 'NormalEdge', begin: 'node_n', end: 'out_n',
                    segments: [{ tags: { name: '本通り' } }]
                },
                road_e: {
                    id: 'road_e', type: 'NormalEdge', begin: 'node_e', end: 'out_e',
                    segments: [{ tags: { name: 'クロス通り' } }]
                },
                road_w: {
                    id: 'road_w', type: 'NormalEdge', begin: 'node_w', end: 'out_w',
                    segments: [{ tags: { name: 'クロス通り' } }]
                },
                // 交差点内部の進行ルート（MapVCrossEdge）
                edge_s_to_n: { id: 'edge_s_to_n', type: 'MapVCrossEdge', begin: 'node_s', end: 'node_n' },
                edge_s_to_e: { id: 'edge_s_to_e', type: 'MapVCrossEdge', begin: 'node_s', end: 'node_e' },
                edge_s_to_w: { id: 'edge_s_to_w', type: 'MapVCrossEdge', begin: 'node_s', end: 'node_w' }
            }
        };
    }

    it('直進する場合、交差する左右の道路名（クロス通り）を返すこと', () => {
        const mapData = createMockMapData(false);
        const straightEdge = mapData.edges.edge_s_to_n; // 直進エッジ

        const result = getCrossingRoadName(mapData, straightEdge);
        
        expect(result).toBe('クロス通り');
    });

    it('右折する場合でも、本通りを除外して交差する道路名（クロス通り）を返すこと', () => {
        const mapData = createMockMapData(false);
        const turnRightEdge = mapData.edges.edge_s_to_e; // 右折エッジ

        const result = getCrossingRoadName(mapData, turnRightEdge);
        
        expect(result).toBe('クロス通り');
    });

    it('【重要】内部のデータ配列順序が変わっても、常に本通りを除外してクロス通りを返すこと', () => {
        // わざと「直進(本通り)」が配列の先頭に来るようにしたデータを使う
        const mapData = createMockMapData(true); 
        const turnRightEdge = mapData.edges.edge_s_to_e; // 右折エッジ

        const result = getCrossingRoadName(mapData, turnRightEdge);
        
        // 修正前はここで先頭の「本通り」を拾ってしまっていたが、修正後は「クロス通り」になる
        expect(result).toBe('クロス通り');
    });
});
