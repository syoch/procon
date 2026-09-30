import { describe, expect, test, vi } from "vitest";
import { applyGsiWidths, GsiRoadIndex, parseGsiRoadTile, removeNarrowEdges, widthClassToMeters } from "../../src/lib/road_width";
import { coordinateToTile, requireGsiRoadSegments, tilesForBoundary } from "../../src/routes/api/gsi";

const feature = (coords: number[][], props: Record<string, unknown>) => ({
  type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: props,
});

describe("widthClassToMeters", () => {
  test("幅員区分を区分の内側の代表値に直す (しきい値との大小関係が区分と一致する)", () => {
    expect(widthClassToMeters("3m未満")).toBeLessThan(3);
    const w1 = widthClassToMeters("3m-5.5m未満")!;
    expect(w1).toBeGreaterThanOrEqual(3);
    expect(w1).toBeLessThan(5.5);
    expect(widthClassToMeters("5.5m-13m未満")).toBeGreaterThanOrEqual(5.5);
    expect(widthClassToMeters("不明")).toBeUndefined();
  });
});

describe("parseGsiRoadTile", () => {
  test("通常部の線だけを区間に分解する (庭園路・徒歩道は使わない)", () => {
    const segs = parseGsiRoadTile({
      type: "FeatureCollection",
      features: [
        feature([[138.85, 37.45], [138.851, 37.45], [138.852, 37.45]], { type: "通常部", rnkWidth: "5.5m-13m未満" }),
        feature([[138.85, 37.46], [138.851, 37.46]], { type: "庭園路", rnkWidth: "5.5m-13m未満" }),
        feature([[138.85, 37.47], [138.851, 37.47]], { type: "徒歩道", rnkWidth: "3m未満" }),
      ],
    });
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ begin: { lat: 37.45, lng: 138.85 }, width: 8 });
  });
});

describe("GsiRoadIndex.findWidth", () => {
  // 東西に走る国土地理院の線 (lat 37.45)
  const index = new GsiRoadIndex([
    { begin: { lat: 37.45, lng: 138.85 }, end: { lat: 37.45, lng: 138.86 }, width: 8 },
  ]);
  const northOf = (m: number) => 37.45 + m / 111195;

  test("近くて向きが同じ OSM の区間には幅員を移す", () => {
    expect(index.findWidth({ lat: northOf(5), lng: 138.852 }, { lat: northOf(5), lng: 138.853 })).toBe(8);
    // 逆向きでも同じ線とみなす
    expect(index.findWidth({ lat: northOf(5), lng: 138.853 }, { lat: northOf(5), lng: 138.852 })).toBe(8);
  });
  test("離れている (12m 超) 区間には移さない", () => {
    expect(index.findWidth({ lat: northOf(20), lng: 138.852 }, { lat: northOf(20), lng: 138.853 })).toBeUndefined();
  });
  test("向きが大きく違う (交差する道) 区間には移さない", () => {
    expect(index.findWidth({ lat: northOf(-20), lng: 138.855 }, { lat: northOf(20), lng: 138.855 })).toBeUndefined();
  });
});

describe("applyGsiWidths / removeNarrowEdges", () => {
  const makeGraph = (): App.OSMGraph => ({
    nodes: {
      a: { type: "MapNode", id: "a", coordinate: { lat: 37.45, lng: 138.851 }, edges: ["e1", "e2", "e3"] },
      b: { type: "MapNode", id: "b", coordinate: { lat: 37.45, lng: 138.852 }, edges: ["e1", "e2", "e3"] },
    },
    edges: {
      e1: { type: "OSMEdge", id: "e1", begin: "a", end: "b", highway: "residential", width: null, sidewalk: null, direction: "both" },
      e2: { type: "OSMEdge", id: "e2", begin: "a", end: "b", highway: "residential", width: 12, sidewalk: null, direction: "both" },
      e3: { type: "OSMEdge", id: "e3", begin: "a", end: "b", highway: "footway", width: null, sidewalk: null, direction: "both" },
    },
  });
  const index = new GsiRoadIndex([{ begin: { lat: 37.45, lng: 138.85 }, end: { lat: 37.45, lng: 138.86 }, width: 4 }]);

  test("幅が分からない車道にだけ補う (OSM の width タグと歩道はそのまま)", () => {
    const graph = makeGraph();
    expect(applyGsiWidths(graph, index)).toBe(1);
    expect(graph.edges.e1.width).toBe(4);
    expect(graph.edges.e2.width).toBe(12);
    expect(graph.edges.e3.width).toBeNull();
  });

  test("下限より狭い道を取り除き、一方通行は下限が緩い", () => {
    const limit = { twoWay: 5.5, oneWay: 3.0 };
    const graph = makeGraph();
    applyGsiWidths(graph, index);
    expect(removeNarrowEdges(graph, limit)).toBe(1);
    expect(Object.keys(graph.edges).sort()).toEqual(["e2", "e3"]);
    expect(graph.nodes.a.edges).not.toContain("e1");

    const oneway = makeGraph();
    applyGsiWidths(oneway, index);
    oneway.edges.e1.direction = "forward";
    expect(removeNarrowEdges(oneway, limit)).toBe(0);
  });
});

describe("タイル", () => {
  test("長岡駅のタイル番号", () => {
    expect(coordinateToTile(37.448016, 138.853301)).toEqual({ x: 58045, y: 25406 });
  });
  test("範囲を覆うタイルを列挙する", () => {
    const tiles = tilesForBoundary({ minLat: 37.4375, maxLat: 37.453125, minLng: 138.84375, maxLng: 138.859375 });
    expect(tiles.length).toBeGreaterThan(4);
    expect(tiles).toContainEqual({ x: 58045, y: 25406 });
  });

  test("キャッシュが無いタイルだけ取得し、取得に失敗したタイルは飛ばして続ける", async () => {
    const saved: string[] = [];
    const fetchTile = vi.fn(async (tile: { x: number; y: number }) => {
      if (tile.x % 2 === 0) throw new Error("network");
      return { features: [feature([[138.85, 37.45], [138.851, 37.45]], { type: "通常部", rnkWidth: "3m未満" })] };
    });
    const segments = await requireGsiRoadSegments(
      { minLat: 37.44, maxLat: 37.442, minLng: 138.85, maxLng: 138.86 },
      {
        readCache: async (tile) => (tile.x === 58045 ? [] : null),
        saveCache: async (tile) => { saved.push(`${tile.x}/${tile.y}`); },
      },
      fetchTile,
    );
    expect(fetchTile).not.toHaveBeenCalledWith(expect.objectContaining({ x: 58045 }));
    expect(saved.every((key) => Number(key.split("/")[0]) % 2 === 1)).toBe(true);
    expect(segments.length).toBe(saved.length);
  });
});
