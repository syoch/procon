import { describe, expect, test } from "vitest";
import { collectRoadJunctions, coordinateKey, detectSharpTurns, detectSharpTurnsOnPath } from "../../src/lib/sharp_turn";

// 長岡付近を原点とし、x (東向き) / y (北向き) [m] で道を描いてから緯度経度に変換する
const ORIGIN = { lat: 37.45, lng: 138.85 };
const M_PER_DEG_LAT = 111195;
const M_PER_DEG_LNG = M_PER_DEG_LAT * Math.cos((ORIGIN.lat * Math.PI) / 180);
const toCoord = ([x, y]: number[]): App.Coordinate => ({
  lat: ORIGIN.lat + y / M_PER_DEG_LAT,
  lng: ORIGIN.lng + x / M_PER_DEG_LNG,
});

/** 点列 [m] をセグメント列にする */
function road(points: number[][], highway = "residential"): App.Segment[] {
  const segs: App.Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segs.push({
      begin_coordinate: toCoord(points[i]),
      end_coordinate: toCoord(points[i + 1]),
      highway,
      width: 4,
      sidewalk: "no",
      tags: {}
    });
  }
  return segs;
}

/**
 * 東向きに 50m 直進 → 半径 radius で angleDeg 左に曲がる円弧 (頂点間隔 step m) → 50m 直進
 * (angleDeg が負なら右に曲がる)
 */
function curvedRoad(radius: number, angleDeg: number, step = 5): number[][] {
  const pts: number[][] = [[-50, 0], [0, 0]];
  const sign = Math.sign(angleDeg);
  const theta = (Math.abs(angleDeg) * Math.PI) / 180;
  const n = Math.max(1, Math.round((radius * theta) / step));
  // 円の中心は (0, sign * radius)
  for (let k = 1; k <= n; k++) {
    const a = (theta * k) / n;
    pts.push([radius * Math.sin(a), sign * (radius - radius * Math.cos(a))]);
  }
  const last = pts[pts.length - 1];
  pts.push([last[0] + 50 * Math.cos(theta), last[1] + sign * 50 * Math.sin(theta)]);
  return pts;
}

const CAR = { minRadius: 0 };
const TRUCK = { minRadius: 20 };

describe("detectSharpTurns", () => {
  test("まっすぐな道には急カーブが無い", () => {
    expect(detectSharpTurns(road([[0, 0], [50, 0], [100, 0], [150, 0]]), CAR)).toEqual([]);
  });

  test("直角に曲がる角 (頂点 1 つ) は急カーブ", () => {
    const turns = detectSharpTurns(road([[-50, 0], [0, 0], [0, 50]]), CAR);
    expect(turns).toHaveLength(1);
    expect(turns[0].angle).toBeCloseTo(90, 0);
    expect(turns[0].direction).toBe("left");
    expect(turns[0].radius).toBeLessThan(30);
  });

  test("曲線半径は頂点の数によらず元の円弧の半径に近い", () => {
    for (const step of [2, 5, 10]) {
      const turns = detectSharpTurns(road(curvedRoad(20, 90, step)), CAR);
      expect(turns).toHaveLength(1);
      expect(turns[0].radius).toBeGreaterThan(20 * 0.85);
      expect(turns[0].radius).toBeLessThan(20 * 1.15);
    }
  });

  test("同じ 90° でも半径が大きいゆるいカーブは拾わない", () => {
    expect(detectSharpTurns(road(curvedRoad(100, 90)), CAR)).toEqual([]);
  });

  test("基準の半径は道の種類で変わるが、30m を上限とする (tertiary の 80m は 30m に打ち切り)", () => {
    // tertiary: 半径 60m は道路構造令の基準 (80m) より急だが、上限 30m より緩いので拾わない
    expect(detectSharpTurns(road(curvedRoad(60, 90), "tertiary"), CAR)).toEqual([]);
    expect(detectSharpTurns(road(curvedRoad(25, 90), "tertiary"), CAR)).toHaveLength(1);
    // track は基準が 15m なので、半径 25m のカーブは拾わない
    expect(detectSharpTurns(road(curvedRoad(25, 90), "track"), CAR)).toEqual([]);
  });

  test("大型トラックはモードの下限 (20m) より急なカーブも拾う", () => {
    // track の基準は 15m なので、半径 17m のカーブは車では拾わず、トラックでは拾う
    expect(detectSharpTurns(road(curvedRoad(17, 90), "track"), CAR)).toEqual([]);
    expect(detectSharpTurns(road(curvedRoad(17, 90), "track"), TRUCK)).toHaveLength(1);
  });

  test("合計の角度が小さい (50°未満) 曲がりは拾わない", () => {
    expect(detectSharpTurns(road(curvedRoad(10, 20)), CAR)).toEqual([]);
    expect(detectSharpTurns(road(curvedRoad(10, 45)), CAR)).toEqual([]);
  });

  test("S 字カーブは左右 2 つの急カーブとして拾う", () => {
    const left = curvedRoad(15, 75);
    // 左カーブの出口から、逆向き (右) の円弧を続ける
    const [ox, oy] = left[left.length - 2];
    const heading = (75 * Math.PI) / 180;
    const right: number[][] = [];
    const n = 6;
    for (let k = 1; k <= n; k++) {
      const a = ((75 * Math.PI) / 180) * (k / n);
      // 右カーブの中心は進行方向の右側
      const cx = ox + 15 * Math.sin(heading), cy = oy - 15 * Math.cos(heading);
      right.push([cx - 15 * Math.sin(heading - a), cy + 15 * Math.cos(heading - a)]);
    }
    const pts = [...left.slice(0, -1), ...right, [right[n - 1][0] + 50, right[n - 1][1]]];
    const turns = detectSharpTurns(road(pts), CAR);
    expect(turns.map((t) => t.direction)).toEqual(["left", "right"]);
  });
});

describe("detectSharpTurnsOnPath", () => {
  const cross = (id: string, begin: string, end: string): App.MapVCrossEdge => ({
    type: "MapVCrossEdge", id, begin, end, view_score: 0.5, direction: "both",
  });
  const node = (id: string, p: number[]): App.MapVCrossNode => ({
    type: "MapVCrossNode", id, coordinate: toCoord(p), edges: [], group_nodes: [],
  });

  test("逆向きに格納された道を通ると、曲がる向きも反転する", () => {
    // 道 AB: A(-50,0) → (0,0) → B(0,50) の左折。B から A へ進むと右折になる
    const graph: App.SearchGraph = {
      nodes: { A: node("A", [-50, 0]), B: node("B", [0, 50]) },
      edges: {
        AB: { type: "FoldedEdge", id: "AB", begin: "A", end: "B", direction: "both", segments: road([[-50, 0], [0, 0], [0, 50]]) },
      },
    };
    expect(detectSharpTurnsOnPath(graph, ["AB"], "A", CAR).map((t) => t.direction)).toEqual(["left"]);
    expect(detectSharpTurnsOnPath(graph, ["AB"], "B", CAR).map((t) => t.direction)).toEqual(["right"]);
  });

  test("交差点 (MapVCrossEdge) での右左折は拾わない", () => {
    // 東向きの道 → 交差点 → 北向きの道 (交差点で左折しているが、道の途中のカーブではない)
    const graph: App.SearchGraph = {
      nodes: { A: node("A", [-50, 0]), X1: node("X1", [0, 0]), X2: node("X2", [0, 0]), B: node("B", [0, 50]) },
      edges: {
        E1: { type: "FoldedEdge", id: "E1", begin: "A", end: "X1", direction: "both", segments: road([[-50, 0], [0, 0]]) },
        C: cross("C", "X1", "X2"),
        E2: { type: "FoldedEdge", id: "E2", begin: "X2", end: "B", direction: "both", segments: road([[0, 0], [0, 50]]) },
      },
    };
    expect(detectSharpTurnsOnPath(graph, ["E1", "C", "E2"], "A", CAR)).toEqual([]);
  });

  test("交差点以外でつながったエッジ (分割ノードなど) は 1 本の道として扱う", () => {
    // 角の手前で道が分割されていても、角は検出される
    const graph: App.SearchGraph = {
      nodes: {
        A: node("A", [-50, 0]),
        S: { type: "SplittedNode", id: "S", coordinate: toCoord([-5, 0]), edges: [] },
        B: node("B", [0, 50]),
      },
      edges: {
        AS: { type: "FoldedEdge", id: "AS", begin: "A", end: "S", direction: "both", segments: road([[-50, 0], [-5, 0]]) },
        SB: { type: "FoldedEdge", id: "SB", begin: "S", end: "B", direction: "both", segments: road([[-5, 0], [0, 0], [0, 50]]) },
      },
    };
    expect(detectSharpTurnsOnPath(graph, ["AS", "SB"], "A", CAR)).toHaveLength(1);
  });
});

describe("collectRoadJunctions", () => {
  const node = (id: number, p: number[]): App.OSMRawNode => {
    const c = toCoord(p);
    return { type: "node", id, lat: c.lat, lon: c.lng };
  };
  // 1(-50,0) - 2(0,0) - 3(0,50) と曲がる tertiary の角 (2) に、別の道 4(50,0) - 2 がつながる
  const base = (tags: Record<string, string>): App.OSMData => ({
    elements: [
      { type: "way", id: 1, nodes: [1, 2, 3], tags: { highway: "tertiary" } },
      { type: "way", id: 2, nodes: [2, 4], tags },
      node(1, [-50, 0]), node(2, [0, 0]), node(3, [0, 50]), node(4, [50, 0]),
    ],
  });
  const key2 = coordinateKey(toCoord([0, 0]));

  test("track や residential がつながる点は交差点", () => {
    expect(collectRoadJunctions(base({ highway: "track" })).has(key2)).toBe(true);
    expect(collectRoadJunctions(base({ highway: "residential" })).has(key2)).toBe(true);
  });
  test("歩道・駐車場の出入口がつながる点は交差点にしない", () => {
    expect(collectRoadJunctions(base({ highway: "footway" })).has(key2)).toBe(false);
    expect(collectRoadJunctions(base({ highway: "service", service: "driveway" })).has(key2)).toBe(false);
  });
  test("道が端と端でつながっているだけの点は交差点にしない", () => {
    const data: App.OSMData = {
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "tertiary" } },
        { type: "way", id: 2, nodes: [2, 3], tags: { highway: "tertiary" } },
        node(1, [-50, 0]), node(2, [0, 0]), node(3, [0, 50]),
      ],
    };
    expect(collectRoadJunctions(data).size).toBe(0);
  });

  test("交差点での曲がりは急カーブにしないが、交差点でないところのカーブは拾う", () => {
    const corner = road([[-50, 0], [0, 0], [0, 50]], "tertiary");
    const junctions = collectRoadJunctions(base({ highway: "track" }));
    expect(detectSharpTurns(corner, { minRadius: 0 })).toHaveLength(1);
    expect(detectSharpTurns(corner, { minRadius: 0, junctions })).toEqual([]);
    // 交差点から離れた場所のカーブは、交差点があっても拾う
    expect(detectSharpTurns(road(curvedRoad(20, 90, 5).map(([x, y]) => [x + 200, y]), "tertiary"), { minRadius: 0, junctions })).toHaveLength(1);
  });

  test("地図データの取得範囲の外にある曲がりは拾わない (範囲外で交わる道が見えないため)", () => {
    const corner = road([[-50, 0], [0, 0], [0, 50]], "tertiary");
    const inside = { minLat: ORIGIN.lat - 0.01, minLng: ORIGIN.lng - 0.01, maxLat: ORIGIN.lat + 0.01, maxLng: ORIGIN.lng + 0.01 };
    // 角 (0,0) が範囲の北端より外になるように、範囲を南にずらす
    const south = { ...inside, maxLat: ORIGIN.lat - 0.0001 };
    expect(detectSharpTurns(corner, { minRadius: 0, bounds: inside })).toHaveLength(1);
    expect(detectSharpTurns(corner, { minRadius: 0, bounds: south })).toEqual([]);
  });

  test("半径 20m 未満は「急カーブ」、20m 以上は「注意」", () => {
    expect(detectSharpTurns(road(curvedRoad(12, 180)), CAR).map((t) => t.level)).toEqual(["sharp"]);
    expect(detectSharpTurns(road(curvedRoad(25, 90)), CAR).map((t) => t.level)).toEqual(["caution"]);
  });
});

