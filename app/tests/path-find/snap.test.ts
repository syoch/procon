import { describe, expect, test } from "vitest";
import { findNearestEdge } from "../../src/lib/transient-split";

/** 点列を 1 本の FoldedEdge にしたグラフ */
function graphOf(roads: Record<string, App.Coordinate[]>): App.SearchGraph {
  const graph: App.SearchGraph = { nodes: {}, edges: {} };
  for (const [id, pts] of Object.entries(roads)) {
    const b = `${id}-b`, e = `${id}-e`;
    graph.nodes[b] = { type: "SplittedNode", id: b, coordinate: pts[0], edges: [id] };
    graph.nodes[e] = { type: "SplittedNode", id: e, coordinate: pts[pts.length - 1], edges: [id] };
    graph.edges[id] = {
      type: "FoldedEdge", id, begin: b, end: e, direction: "both",
      segments: pts.slice(0, -1).map((p, i) => ({
        begin_coordinate: p, end_coordinate: pts[i + 1], highway: "residential", width: null, sidewalk: null,
      })),
    };
  }
  return graph;
}

describe("findNearestEdge", () => {
  test("道の曲がり角の外側にある点は、角 (端点) に吸着する", () => {
    // 北から来て角 (0,0) で東へ曲がる L 字の道。点は角の南西 (外側) にあり、どちらの区間にも垂線の足が落ちない
    const graph = graphOf({
      near: [{ lat: 0.001, lng: 0 }, { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }],
      far: [{ lat: -0.01, lng: -0.02 }, { lat: -0.01, lng: 0.02 }],
    });
    const res = findNearestEdge(graph, { lat: -0.0005, lng: -0.0005 });
    expect(res?.edgeId).toBe("near");
    expect(res?.projection.lat).toBeCloseTo(0, 6);
    expect(res?.projection.lng).toBeCloseTo(0, 6);
  });

  test("経度方向の縮み (cos(緯度)) を考慮して、本当に近い道を選ぶ", () => {
    // 緯度 60° では経度 1° の長さは緯度 1° の半分。
    // 東 0.001° (約 56m) の南北の道と、北 0.0007° (約 78m) の東西の道では、東の道の方が近い
    const lat = 60, lng = 138;
    const graph = graphOf({
      east: [{ lat: lat - 0.01, lng: lng + 0.001 }, { lat: lat + 0.01, lng: lng + 0.001 }],
      north: [{ lat: lat + 0.0007, lng: lng - 0.01 }, { lat: lat + 0.0007, lng: lng + 0.01 }],
    });
    expect(findNearestEdge(graph, { lat, lng })?.edgeId).toBe("east");
  });
});
