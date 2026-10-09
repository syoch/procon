import { expect, test, vi } from "vitest";
import { CrossConvert } from "../../src/lib/cross_transform";
import { fold2DegreeEdges } from "../../src/lib/fold2degree";
import { pathFind } from "../../src/lib/path_finder";
import { canTraverseBackward, canTraverseForward } from "../../src/lib/utils/direction";

// Node 上では leaflet が window を要求するため、距離計算だけのスタブに差し替える
vi.mock("leaflet", async () => await import("../mocks/leaflet"));

const COORD: Record<string, App.Coordinate> = {
  n0: { lat: 0, lng: 0 },
  n1: { lat: 0, lng: 0.001 },
  n2: { lat: 0, lng: 0.002 },
  n3: { lat: 0, lng: 0.003 },
  x: { lat: 0.001, lng: 0 },
  y: { lat: -0.001, lng: 0 },
  z: { lat: 0.001, lng: 0.003 },
  w: { lat: -0.001, lng: 0.003 },
};

function osmEdge(id: string, begin: string, end: string, direction: App.TravelDirection): App.OSMEdge {
  return { type: "OSMEdge", id, begin, end, direction, highway: "residential", width: 3, sidewalk: "both", tags: {} };
}

function buildOSM(edgeList: App.OSMEdge[]): App.OSMGraph {
  const nodes: { [key: App.NodeId]: App.MapNode } = {};
  const edges: { [key: App.EdgeId]: App.OSMEdge } = {};
  for (const e of edgeList) {
    edges[e.id] = e;
    for (const nid of [e.begin, e.end]) {
      if (!nodes[nid]) {
        nodes[nid] = { type: "MapNode", id: nid, coordinate: COORD[nid], edges: [] };
      }
      nodes[nid].edges.push(e.id);
    }
  }
  return { nodes, edges };
}

function foldEdges(edgeList: App.OSMEdge[]): App.SearchGraph {
  const cc = CrossConvert(buildOSM(edgeList));
  if (cc instanceof Error) throw cc;
  const sg = fold2DegreeEdges(cc);
  if (sg instanceof Error) throw sg;
  return sg;
}

function edgeBetween(sg: App.SearchGraph, a: App.NodeId, b: App.NodeId): App.FoldedEdge | undefined {
  return Object.values(sg.edges).find(
    (e): e is App.FoldedEdge =>
      e.type === "FoldedEdge" && ((e.begin === a && e.end === b) || (e.begin === b && e.end === a)),
  );
}

function allows(edge: App.FoldedEdge, from: App.NodeId, to: App.NodeId): boolean {
  if (edge.begin === from && edge.end === to) return canTraverseForward(edge.direction);
  if (edge.begin === to && edge.end === from) return canTraverseBackward(edge.direction);
  return false;
}

// チェーン n0-n1-n2-n3 の両端を交差点(次数3)にして、n1・n2 を畳み込ませる
function chainEdges(dir: App.TravelDirection): App.OSMEdge[] {
  return [
    osmEdge("e0", "n0", "n1", "both"),
    osmEdge("e1", "n1", "n2", dir),
    osmEdge("e2", "n2", "n3", "both"),
    osmEdge("ex", "n0", "x", "both"),
    osmEdge("ey", "n0", "y", "both"),
    osmEdge("ez", "n3", "z", "both"),
    osmEdge("ew", "n3", "w", "both"),
  ];
}

function noneEdges(): App.OSMEdge[] {
  return [
    osmEdge("e0", "n0", "n1", "forward"), // n0 -> n1
    osmEdge("e1", "n2", "n1", "forward"), // n2 -> n1
    osmEdge("ex", "n0", "x", "both"),
    osmEdge("ey", "n0", "y", "both"),
    osmEdge("ez", "n2", "z", "both"),
    osmEdge("ew", "n2", "w", "both"),
  ];
}

test("forward の一方通行を含むチェーンは n0 側 → n3 側のみ通行可", () => {
  const chain = edgeBetween(foldEdges(chainEdges("forward")), "n0_n1", "n3_n2");
  expect(chain).toBeDefined();
  expect(allows(chain as App.FoldedEdge, "n0_n1", "n3_n2")).toBe(true);
  expect(allows(chain as App.FoldedEdge, "n3_n2", "n0_n1")).toBe(false);
});

test("backward の一方通行を含むチェーンは n3 側 → n0 側のみ通行可", () => {
  const chain = edgeBetween(foldEdges(chainEdges("backward")), "n0_n1", "n3_n2");
  expect(chain).toBeDefined();
  expect(allows(chain as App.FoldedEdge, "n0_n1", "n3_n2")).toBe(false);
  expect(allows(chain as App.FoldedEdge, "n3_n2", "n0_n1")).toBe(true);
});

test("両側から流入する一方通行のチェーンは none (通行不可)", () => {
  const chain = edgeBetween(foldEdges(noneEdges()), "n0_n1", "n2_n1");
  expect(chain).toBeDefined();
  expect((chain as App.FoldedEdge).direction).toBe("none");
});

function crossNode(id: App.NodeId, lat: number, lng: number): App.MapVCrossNode {
  return { type: "MapVCrossNode", id, coordinate: { lat, lng }, edges: [], group_nodes: [id] };
}

function compEdge(
  id: App.EdgeId,
  begin: App.NodeId,
  end: App.NodeId,
  direction: App.TravelDirection,
  bc: App.Coordinate,
  ec: App.Coordinate,
): App.ComputedEdge {
  return {
    type: "ComputedEdge",
    id,
    begin,
    end,
    direction,
    segments: [{ begin_coordinate: bc, end_coordinate: ec, highway: "residential", width: 3, sidewalk: "both", tags: {} }],
    width_score: 0,
    view_score: 0,
    mix_score: 0,
  };
}

function buildSearchGraph(): App.SearchGraph {
  const g: App.SearchGraph = {
    nodes: {
      A: crossNode("A", 0, 0),
      B: crossNode("B", 0, 0.001),
      C: crossNode("C", 0, 0.002),
    },
    edges: {
      eAB: compEdge("eAB", "A", "B", "forward", { lat: 0, lng: 0 }, { lat: 0, lng: 0.001 }),
      eBC: compEdge("eBC", "B", "C", "both", { lat: 0, lng: 0.001 }, { lat: 0, lng: 0.002 }),
    },
  };
  // node.edges の不変条件を満たす
  for (const e of Object.values(g.edges)) {
    g.nodes[e.begin].edges.push(e.id);
    if (e.begin !== e.end) g.nodes[e.end].edges.push(e.id);
  }
  return g;
}

test("探索は一方通行を尊重する", () => {
  const params: App.SearchParameters = {
    lambda: 1,
    mix_score_weight: 0,
    view_score_weight: 0,
    width_score_weight: 0,
  };
  // A -> B は一方通行 (forward) なので A -> C は通れる
  expect(pathFind(buildSearchGraph(), params, ["A"], ["C"])).toEqual(["eAB", "eBC"]);
  // 逆向き C -> A は B -> A が逆走になるため経路なし
  expect(pathFind(buildSearchGraph(), params, ["C"], ["A"])).toEqual([]);
});
