import { CalculateCost } from "./cost_calculator";
import { canTraverseBackward, canTraverseForward } from "./utils/direction";
import { distanceOf } from "./utils/haversine";

type SearchPath = {
  cost: number;
  base_node: App.MapVCrossNode | App.SplittedNode;
  node: App.MapVCrossNode | App.SplittedNode;
  path: App.EdgeId[];
};
type SearchState = {
  paths: SearchPath[];
  min_cost: number;
  cost_cache: Record<App.EdgeId, number>;
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

function step_search(
  map: App.SearchGraph,
  params: App.SearchParameters,
  state: SearchState,
  endNodes: App.NodeId[],
): { success: true, state: SearchState } | { success: false, error: string } {
  state.min_cost = Math.min(
    ...state.paths
      .filter((p) => endNodes.includes(p.node.id))
      .map((p) => p.cost),
  );

  let newPaths: Map<App.NodeId, SearchPath> = new Map();
  const addPath = (path: SearchPath) => {
    if (path.cost > state.min_cost) return;

    if (!newPaths.has(path.node.id)) {
      newPaths.set(path.node.id, path);
      return
    }

    const existing_path = newPaths.get(path.node.id)!;
    if (path.cost < existing_path.cost) {
      newPaths.set(path.node.id, path);
    }
  }

  for (const old_path of state.paths) {
    if (endNodes.includes(old_path.node.id)) {
      addPath(old_path);
      continue;
    }

    // 一方通行を考慮し、進行可能な向きのエッジだけを隣接として扱う。
    // 隣接エッジは node.edges から引く (全エッジ走査を避ける)
    const neighbors = (old_path.node.edges ?? [])
      .map((edgeId) => map.edges[edgeId])
      .filter((edge) =>
        edge && (
          (edge.begin === old_path.node.id && canTraverseForward(edge.direction)) ||
          (edge.end === old_path.node.id && canTraverseBackward(edge.direction))
        )
      );

    for (const edge of neighbors) {
      // 隣接エッジについて、 FoldedEdge の場合コスト計算を行う。
      // それ以外のエッジはそのまま使用する。
      let neighbor: App.ComputedEdge | App.MapVCrossEdge;
      if (edge.type === "FoldedEdge") {
        let new_edge = CalculateCost(edge);
        if (new_edge instanceof Error) {
          return { success: false, error: `Error calculating cost for edge ${edge.id}: ${new_edge.message}` };
        }
        map.edges[new_edge.id] = new_edge;
        neighbor = new_edge;
      } else {
        neighbor = edge;
      }

      // 閉路を避けるために、すでに通ったエッジを再度通らないようにする
      if (old_path.path.includes(neighbor.id)) continue;

      const edgeCost = state.cost_cache[neighbor.id] ?? calculateEdgeCost(neighbor, params);
      state.cost_cache[neighbor.id] = edgeCost;

      const new_cost = old_path.cost + edgeCost;

      addPath({
        base_node: old_path.base_node,
        cost: new_cost,
        node: neighbor.begin === old_path.node.id ? map.nodes[neighbor.end] : map.nodes[neighbor.begin],
        path: [...old_path.path, neighbor.id],
      });
    }
  }
  return {
    success: true,
    state: {
      paths: Array.from(newPaths.values()),
      min_cost: state.min_cost,
      cost_cache: state.cost_cache,
    },
  };
}

function generateInitSearchState(graph: App.SearchGraph, beginNodes: App.NodeId[]): SearchState {
  let paths: SearchPath[] = [];
  for (const nodeId of beginNodes) {
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
  return {
    paths: paths,
    min_cost: 0,
    cost_cache: {},
  };
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
  let state = generateInitSearchState(graph, begin);
  while (true) {
    const result = step_search(graph, params, state, endNodes);
    if (!result.success) {
      console.error(result.error);
      return [];
    }
    state = result.state;

    if (state.paths.length === 0) {
      return [];
    }
    if (state.paths.every(p => endNodes.includes(p.node.id) && p.cost === state.min_cost)) {
      return state.paths[0].path;
    }
  }
}