import { describe, expect, test } from "vitest";
import {
  hasCenterLine, parseLanes, parseMaxspeed, segmentSpeedKmh, travelTimeFactor, travelTimeSeconds, type SpeedProfile,
} from "../../src/lib/travel_speed";
import { MODE_PROFILES } from "../../src/lib/mode_profiles";
import { transformOSMMapToOSMGraph } from "../../src/lib/osm/graph";
import { pathFind } from "../../src/lib/path_finder";

const car = MODE_PROFILES.car.speed;
const truck = MODE_PROFILES.truck.speed;
const walk = MODE_PROFILES.walk.speed;

describe("parseMaxspeed / parseLanes", () => {
  test("数値と単位付きの値を km/h に直す", () => {
    expect(parseMaxspeed("50")).toBe(50);
    expect(parseMaxspeed("50 km/h")).toBe(50);
    expect(parseMaxspeed("30 mph")).toBeCloseTo(48.28, 1);
  });
  test("数値でない値は読めない (undefined)", () => {
    for (const v of ["none", "signals", "JP:urban", "", undefined, "0"]) {
      expect(parseMaxspeed(v)).toBeUndefined();
    }
  });
  test("車線数は正の整数だけ読む", () => {
    expect(parseLanes("2")).toBe(2);
    expect(parseLanes("1.5")).toBeUndefined();
    expect(parseLanes("two")).toBeUndefined();
  });
});

describe("hasCenterLine (中央線の推定)", () => {
  test("幹線は中央線あり", () => {
    expect(hasCenterLine({ highway: "tertiary", width: null })).toBe(true);
  });
  test("住宅地の道は、2 車線以上か幅 5.5m 以上なら中央線あり", () => {
    expect(hasCenterLine({ highway: "residential", width: null, lanes: 2 })).toBe(true);
    expect(hasCenterLine({ highway: "residential", width: 8 })).toBe(true);
    expect(hasCenterLine({ highway: "residential", width: 4 })).toBe(false);
    expect(hasCenterLine({ highway: "residential", width: null })).toBe(false);
  });
});

describe("segmentSpeedKmh (想定速度)", () => {
  test("高速道路は車 100 km/h、大型トラック 90 km/h (標識の速度があっても超えない)", () => {
    expect(segmentSpeedKmh(car, { highway: "motorway", width: null })).toBe(100);
    expect(segmentSpeedKmh(truck, { highway: "motorway", width: null })).toBe(90);
    expect(segmentSpeedKmh(truck, { highway: "motorway", width: null, maxspeed: 100 })).toBe(90);
    expect(segmentSpeedKmh(car, { highway: "motorway", width: null, maxspeed: 80 })).toBe(80);
  });
  test("一般道路は maxspeed タグ > 中央線あり 60 km/h > 中央線なし 30 km/h", () => {
    expect(segmentSpeedKmh(car, { highway: "residential", width: null, maxspeed: 40 })).toBe(40);
    expect(segmentSpeedKmh(car, { highway: "primary", width: null })).toBe(60);
    expect(segmentSpeedKmh(car, { highway: "residential", width: null })).toBe(30);
  });
  test("ランプ: 高速道路は 40 km/h、一般道路の幹線は本線と同じ 60 km/h", () => {
    expect(segmentSpeedKmh(car, { highway: "motorway_link", width: null })).toBe(40);
    expect(segmentSpeedKmh(truck, { highway: "motorway_link", width: null })).toBe(40);
    for (const highway of ["trunk_link", "primary_link", "secondary_link", "tertiary_link"]) {
      expect(segmentSpeedKmh(car, { highway, width: null })).toBe(60);
    }
  });
  test("高速道路のランプも、標識の速度が本線の上限を超えない", () => {
    expect(segmentSpeedKmh(truck, { highway: "motorway_link", width: null, maxspeed: 100 })).toBe(90);
    expect(segmentSpeedKmh(car, { highway: "motorway_link", width: null, maxspeed: 120 })).toBe(100);
    expect(segmentSpeedKmh(car, { highway: "motorway_link", width: null, maxspeed: 60 })).toBe(60);
  });
  test("徒歩は道によらず一定", () => {
    expect(segmentSpeedKmh(walk, { highway: "primary", width: null })).toBe(4.8);
  });
});

describe("travelTimeFactor / travelTimeSeconds", () => {
  test("車系は 60 km/h の道が距離のまま、30 km/h の道が 2 倍。速度一定のモードと未指定は 1", () => {
    expect(travelTimeFactor(car, { highway: "primary", width: null })).toBe(1);
    expect(travelTimeFactor(car, { highway: "residential", width: null })).toBe(2);
    expect(travelTimeFactor(walk, { highway: "residential", width: null })).toBe(1);
    expect(travelTimeFactor(undefined, { highway: "residential", width: null })).toBe(1);
  });
  test("所要時間 [秒] は距離 / 想定速度", () => {
    expect(travelTimeSeconds(car, [{ highway: "residential", width: null, distance: 1000 }])).toBeCloseTo(120);
    expect(travelTimeSeconds(walk, [{ highway: "residential", width: null, distance: 80 }])).toBeCloseTo(60);
  });
});

describe("osm/graph.js: maxspeed / lanes タグを読む", () => {
  test("エッジに km/h と車線数が入り、多重辺は大きい方を採る", () => {
    const graph = transformOSMMapToOSMGraph({
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential", maxspeed: "30", lanes: "1" } },
        { type: "way", id: 2, nodes: [2, 1], tags: { highway: "residential", maxspeed: "40 km/h", lanes: "2" } },
        { type: "way", id: 3, nodes: [2, 3], tags: { highway: "residential" } },
        { type: "node", id: 1, lat: 0, lon: 0 },
        { type: "node", id: 2, lat: 0, lon: 0.001 },
        { type: "node", id: 3, lat: 0, lon: 0.002 },
      ],
    });
    if (graph instanceof Error) throw graph;
    const edges = Object.values(graph.edges);
    const merged = edges.find((e) => [e.begin, e.end].sort().join() === "1,2")!;
    expect(merged.maxspeed).toBe(40);
    expect(merged.lanes).toBe(2);
    const plain = edges.find((e) => [e.begin, e.end].sort().join() === "2,3")!;
    expect(plain.maxspeed).toBeNull();
    expect(plain.lanes).toBeNull();
  });
  test("多重辺の片方だけに maxspeed があれば、way の並び順によらずその値を採る", () => {
    const tagged: App.OSMRawWay = { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential", maxspeed: "40" } };
    const plain: App.OSMRawWay = { type: "way", id: 2, nodes: [1, 2], tags: { highway: "residential" } };
    for (const ways of [[tagged, plain], [plain, tagged]]) {
      const graph = transformOSMMapToOSMGraph({
        elements: [...ways, { type: "node", id: 1, lat: 0, lon: 0 }, { type: "node", id: 2, lat: 0, lon: 0.001 }],
      });
      const edges = Object.values(graph.edges);
      expect(edges).toHaveLength(1);
      expect(edges[0].maxspeed).toBe(40);
    }
  });
});

describe("pathFind: 車系は所要時間で、徒歩は距離で経路を選ぶ", () => {
  // A → B に、住宅地の道 (直進・30 km/h) と、約 1.3 倍の長さの幹線 (C 経由・60 km/h) がある
  const A = { lat: 0, lng: 0 }, B = { lat: 0, lng: 0.001 }, C = { lat: 0.00042, lng: 0.0005 };
  function graph(): App.SearchGraph {
    const node = (id: string, coordinate: App.Coordinate, edges: string[]): App.SplittedNode => ({ type: "SplittedNode", id, coordinate, edges });
    const edge = (id: string, begin: string, end: string, from: App.Coordinate, to: App.Coordinate, highway: string): App.FoldedEdge => ({
      type: "FoldedEdge", id, begin, end, direction: "both",
      segments: [{ begin_coordinate: from, end_coordinate: to, highway, width: null, sidewalk: null }],
    });
    return {
      nodes: { A: node("A", A, ["AB", "AC"]), B: node("B", B, ["AB", "CB"]), C: node("C", C, ["AC", "CB"]) },
      edges: {
        AB: edge("AB", "A", "B", A, B, "residential"),
        AC: edge("AC", "A", "C", A, C, "tertiary"),
        CB: edge("CB", "C", "B", C, B, "tertiary"),
      },
    };
  }
  // スコアの影響を除くため λ = 0 (速さだけで選ぶ)
  const params = { ...MODE_PROFILES.car.defaultParameters, lambda: 0 };

  test("車は遠回りでも速い幹線を選ぶ", () => {
    expect(pathFind(graph(), params, ["A"], ["B"], { speed: car })).toEqual(["AC", "CB"]);
  });
  test("想定速度を渡さない (従来) と、短い住宅地の道を選ぶ", () => {
    expect(pathFind(graph(), params, ["A"], ["B"])).toEqual(["AB"]);
  });
  test("徒歩 (速度一定) は距離で選ぶので短い方", () => {
    const profile: SpeedProfile = walk;
    expect(pathFind(graph(), params, ["A"], ["B"], { speed: profile })).toEqual(["AB"]);
  });
});
