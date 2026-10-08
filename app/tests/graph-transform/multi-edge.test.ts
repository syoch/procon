import { describe, expect, test } from "vitest";
import { transformOSMMapToOSMGraph } from "../../src/lib/osm/graph";
import { CrossConvert } from "../../src/lib/cross_transform";
import { fold2DegreeEdges } from "../../src/lib/fold2degree";

const node = (id: number, lat: number, lon: number): App.OSMRawNode => ({ type: "node", id, lat, lon });

describe("多重辺 (同じ 2 ノード間の複数のエッジ) の扱い", () => {
  test("way が同じ区間を往復しても (a→b→a) 交差点変換でエラーにならない", () => {
    // 1-2-3 の道に、2 から 11 へ出て 12 で折り返し 11 に戻ってから 13 へ抜ける小道が付いている
    const graph = transformOSMMapToOSMGraph({
      elements: [
        { type: "way", id: 1, nodes: [1, 2, 3], tags: { highway: "residential" } },
        { type: "way", id: 2, nodes: [3, 11, 12, 11, 13], tags: { highway: "path" } },
        node(1, 0, 0), node(2, 0, 0.005), node(3, 0, 0.01),
        node(11, 0.001, 0.01), node(12, 0.002, 0.01), node(13, 0.001, 0.011),
      ],
    });

    // 11-12 間のエッジは 1 本にまとめられる
    const between = Object.values(graph.edges).filter(
      (e) => (e.begin === "11" && e.end === "12") || (e.begin === "12" && e.end === "11"),
    );
    expect(between).toHaveLength(1);

    const cc = CrossConvert(graph);
    expect(cc).not.toBeInstanceOf(Error);
    expect(fold2DegreeEdges(cc as App.CrossConvertedGraph)).not.toBeInstanceOf(Error);
  });

  test("重なった 2 本の一方通行が逆向きなら、まとめたエッジは両方向に通れる", () => {
    const graph = transformOSMMapToOSMGraph({
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential", oneway: "yes" } },
        { type: "way", id: 2, nodes: [2, 1], tags: { highway: "residential", oneway: "yes" } },
        node(1, 0, 0), node(2, 0, 0.001),
      ],
    });
    const edges = Object.values(graph.edges);
    expect(edges).toHaveLength(1);
    expect(edges[0].direction).toBe("both");
  });

  test("重なった 2 本が同じ向きの一方通行なら、一方通行のまま", () => {
    const graph = transformOSMMapToOSMGraph({
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential", oneway: "yes" } },
        { type: "way", id: 2, nodes: [1, 2], tags: { highway: "footway", oneway: "yes" } },
        node(1, 0, 0), node(2, 0, 0.001),
      ],
    });
    const edges = Object.values(graph.edges);
    expect(edges).toHaveLength(1);
    expect(edges[0].direction).toBe("forward");
  });

  test("重なった道のタグは、way の並び順によらず両方から合成される", () => {
    // 同じ 2 点の間に primary (幅 12m・両側歩道) と footway が重なっている
    const primary: App.OSMRawWay = { type: "way", id: 100, nodes: [1, 2], tags: { highway: "primary", width: "12", sidewalk: "both" } };
    const footway: App.OSMRawWay = { type: "way", id: 200, nodes: [1, 2], tags: { highway: "footway" } };
    const nodes = [node(1, 0, 0), node(2, 0, 0.001)];
    for (const ways of [[primary, footway], [footway, primary]]) {
      const edges = Object.values(transformOSMMapToOSMGraph({ elements: [...ways, ...nodes] }).edges);
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({ highway: "primary", width: 12, sidewalk: "both" });
    }
  });

  test("左右の歩道が別々の way に付いていれば両側とみなす", () => {
    const edges = Object.values(transformOSMMapToOSMGraph({
      elements: [
        { type: "way", id: 1, nodes: [1, 2], tags: { highway: "residential", sidewalk: "left" } },
        { type: "way", id: 2, nodes: [1, 2], tags: { highway: "residential", sidewalk: "right" } },
        node(1, 0, 0), node(2, 0, 0.001),
      ],
    }).edges);
    expect(edges[0].sidewalk).toBe("both");
  });
});

