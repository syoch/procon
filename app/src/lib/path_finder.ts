import { CalculateCost } from "./cost_calculator";
import { canTraverseBackward, canTraverseForward } from "./utils/direction";
import { distanceOf } from "./utils/haversine";

type SearchPath = {
  cost: number;
  base_node: App.MapVCrossNode | App.SplittedNode;
  node: App.MapVCrossNode | App.SplittedNode;
  path: App.EdgeId[];
};

function calculateEdgeLength(edge: App.ComputedEdge) {
  return edge.segments
    .map(x => distanceOf(x.begin_coordinate, x.end_coordinate))
    .reduce((prev, acc) => acc + prev, 0);
}

function calculateEdgeCost(edge: App.ComputedEdge | App.MapVCrossEdge, params: App.SearchParameters): number {
  let view_score = edge.type === "ComputedEdge" ? edge.view_score : edge.type === "MapVCrossEdge" ? edge.view_score : 0;
  let width_score = edge.type === "ComputedEdge" ? edge.width_score : edge.type === "MapVCrossEdge" ? 0 : 0;
  let mix_score = edge.type === "ComputedEdge" ? edge.mix_score : edge.type === "MapVCrossEdge" ? 0 : 0;
  let distance = edge.type === "ComputedEdge" ? calculateEdgeLength(edge) : 10;

  const lambda = params.lambda;
  const a1 = params.view_score_weight;
  const a2 = params.width_score_weight;
  const a3 = params.mix_score_weight;

  let score = a1 * view_score + a2 * width_score + a3 * mix_score;
  let cost = distance * (1 + lambda * (1 - score));
  return cost;
}

function traversable(edge: App.SearchGraph["edges"][string], old_path: SearchPath) {
  return (
    (edge.begin === old_path.node.id && canTraverseForward(edge.direction)) ||
    (edge.end === old_path.node.id && canTraverseBackward(edge.direction))
  );
}

function getComputedNode(graph: App.SearchGraph, edge: App.SearchGraph["edges"][string]) {
  // 隣接エッジについて、 FoldedEdge の場合コスト計算を行う。
  // それ以外のエッジはそのまま使用する。

  if (edge.type === "FoldedEdge") {
    let new_edge = CalculateCost(edge);
    if (new_edge instanceof Error) {
      throw new Error(`Error calculating cost for edge ${edge.id}: ${new_edge.message}`);
    }
    graph.edges[new_edge.id] = new_edge;
    return new_edge;
  } else {
    return edge;
  }
}

/**
 * @brief 経路探索を行う
 * @param graph 探索対象のグラフ
 * @param begin 探索開始地点
 * @param endNodes 探索終了地点
 * @returns 経路の辺リスト
 */
export function pathFind(graph: App.SearchGraph, params: App.SearchParameters, begin: App.NodeId[], endNodes: App.NodeId[]): App.EdgeId[] {

  if (begin.length === 0 || endNodes.length === 0) {
    return [];
  }

  let paths: SearchPath[] = [];
  for (const nodeId of begin) {
    const node = graph.nodes[nodeId];
    if (!node) {
      throw new Error(`Node with ID ${nodeId} not found in the graph.`);
    }
    paths.push({
      cost: 0,
      base_node: node,
      node: node,
      path: [],
    });
  }

  let endNodeSet = new Set(endNodes);
  let nodeCostMap: Map<App.NodeId, number> = new Map();
  let edgeCostCache: Map<App.NodeId, number> = new Map();

  let min_cost = 0;
  while (true) {
    min_cost = Math.min(
      ...paths
        .filter((p) => endNodeSet.has(p.node.id))
        .map((p) => p.cost),
    );

    let newPaths: Map<App.NodeId, SearchPath> = new Map();
    const addPath = (path: SearchPath) => {
      if (path.cost > min_cost) return;

      const existing_path = newPaths.get(path.node.id)!;
      if (path.cost > existing_path?.cost) {
        return;
      }

      newPaths.set(path.node.id, path);
    }


    for (const old_path of paths) {
      if (endNodeSet.has(old_path.node.id)) {
        addPath(old_path);
        continue;
      }

      for (const edgeId of (old_path.node.edges ?? [])) {
        // 一方通行を考慮し、進行可能な向きのエッジだけを隣接として扱う。
        const edge = graph.edges[edgeId];
        if (!edge) continue;
        if (!traversable(edge, old_path)) {
          continue;
        }


        const neighbor = getComputedNode(graph, edge);

        // 閉路を避けるために、すでに通ったエッジを再度通らないようにする
        if (old_path.path.includes(neighbor.id)) continue;

        const edgeCost = edgeCostCache.get(neighbor.id) ?? calculateEdgeCost(neighbor, params);
        edgeCostCache.set(neighbor.id, edgeCost);

        const new_cost = old_path.cost + edgeCost;

        addPath({
          base_node: old_path.base_node,
          cost: new_cost,
          node: neighbor.begin === old_path.node.id ? graph.nodes[neighbor.end] : graph.nodes[neighbor.begin],
          path: [...old_path.path, neighbor.id],
        });
      }
    }

    paths = Array.from(newPaths.values());
    if (paths.length === 0) {
      return [];
    }
    if (paths.every(p => endNodeSet.has(p.node.id) && p.cost === min_cost)) {
      return paths[0].path;
    }
  }
}