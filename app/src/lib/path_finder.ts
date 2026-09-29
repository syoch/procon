import { CalculateCost } from "./cost_calculator";
import { canTraverseBackward, canTraverseForward } from "./utils/direction";
import { distanceOf } from "./utils/haversine";
import { PriorityQueue } from "./utils/priorityQueue";

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

/** 探索のオプション */
export type PathFindOptions = {
  /** 一方通行を無視する (徒歩モード用) */
  ignoreOneway?: boolean;
};

function traversable(edge: App.SearchGraph["edges"][string], node: App.NodeId, options: PathFindOptions = {}) {
  if (options.ignoreOneway) {
    return edge.begin === node || edge.end === node;
  }
  return (
    (edge.begin === node && canTraverseForward(edge.direction)) ||
    (edge.end === node && canTraverseBackward(edge.direction))
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
 * @param options 探索のオプション (一方通行を無視するか など)
 * @returns 経路の辺リスト
 */
export function pathFind(graph: App.SearchGraph, params: App.SearchParameters, begin: App.NodeId[], endNodes: App.NodeId[], options: PathFindOptions = {}): App.EdgeId[] {

  if (begin.length === 0 || endNodes.length === 0) {
    return [];
  }

  let endNodeSet = new Set(endNodes);
  let prevMap: Map<App.NodeId, App.EdgeId> = new Map();
  let nodeCostMap: Map<App.NodeId, number> = new Map();
  let edgeCostCache: Map<App.EdgeId, number> = new Map();

  const updateCost = (edgeId: App.EdgeId, nextNodeId: App.NodeId, cost: number) => {
    const prevCost = nodeCostMap.get(nextNodeId);
    if (prevCost === undefined || cost < prevCost) {
      nodeCostMap.set(nextNodeId, cost);
      prevMap.set(nextNodeId, edgeId);
      return true;
    }
    return false;
  }

  let queue = new PriorityQueue<[App.NodeId, number]>();
  for (const nodeId of begin) {
    queue.enqueue([nodeId, 0], 0);
    nodeCostMap.set(nodeId, 0);
  }

  while (!queue.isEmpty()) {
    let [currentNodeId, currentCost] = queue.dequeue()!;
    if (nodeCostMap.get(currentNodeId) !== currentCost) {
      continue;
    }
    let currentNode = graph.nodes[currentNodeId];

    if (endNodeSet.has(currentNodeId)) {
      let path: App.EdgeId[] = [];
      let nodeId = currentNodeId;
      while (prevMap.has(nodeId)) {
        const edgeId = prevMap.get(nodeId)!;
        path.push(edgeId);
        const edge = graph.edges[edgeId];
        nodeId = edge.begin === nodeId ? edge.end : edge.begin;
      }
      return path.reverse();
    }

    // 隣接ノードを探索
    for (const edgeId of currentNode.edges) {
      const edge = graph.edges[edgeId];
      if (!edge) continue;
      if (!traversable(edge, currentNodeId, options)) {
        continue;
      }

      const nextNodeId = edge.begin === currentNodeId ? edge.end : edge.begin;
      const computedEdge = getComputedNode(graph, edge);

      const edgeCost = edgeCostCache.get(edge.id) ?? calculateEdgeCost(computedEdge, params);
      edgeCostCache.set(edge.id, edgeCost);

      const totalCost = currentCost + edgeCost;

      const updated = updateCost(edge.id, nextNodeId, totalCost);
      if (updated) {
        queue.enqueue([nextNodeId, totalCost], totalCost);
      }
    }
  }

  // 経路が見つからなかった場合は空の配列を返す
  return [];
}