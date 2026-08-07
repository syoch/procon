import { CalculateCost } from "./cost_calculator";

type SearchPath = {
  cost: number;
  base_node: App.NodeId;
  node: App.NodeId;
  path: App.EdgeId[];
};
type SearchState = {
  paths: SearchPath[];
  min_cost: number;
};


function calculateEdgeCost(edge: App.ComputedEdge | App.MapVCrossEdge, params: App.SearchParameters): number {
  let view_score = edge.type === "ComputedEdge" ? edge.view_score : edge.type == "MapVCrossEdge" ? edge.view_score : 0;
  let width_score = edge.type === "ComputedEdge" ? edge.width_score : edge.type == "MapVCrossEdge" ? 0 : 0;
  let mix_score = edge.type === "ComputedEdge" ? edge.mix_score : edge.type == "MapVCrossEdge" ? 0 : 0;
  let distance = 100; // Issue #17 により定数としている

  const lambda = params.lambda;
  const a1 = params.view_score_weight;
  const a2 = params.width_score_weight;
  const a3 = params.mix_score_weight;

  let score = a1 * view_score + a2 * width_score + a3 * mix_score;
  let cost = distance * (1 - score * lambda);
  return cost;
}
export function step_search(
  map: App.SearchGraph,
  params: App.SearchParameters,
  state: SearchState,
  endNodes: App.NodeId[],
): SearchState {
  state.min_cost = Math.min(
    ...state.paths
      .filter((p) => endNodes.includes(p.node))
      .map((p) => p.cost),
  );

  let new_paths: SearchPath[] = [];
  for (const old_path of state.paths) {
    if (endNodes.includes(old_path.node)) {
      if (old_path.cost > state.min_cost) continue;
      new_paths.push(old_path);
      continue;
    }

    let neighbors = Object.entries(map.edges)
      .filter(([edgeId, edge]) => edge.begin === old_path.node || edge.end === old_path.node)
      .map(([edgeId, edge]) => edge);
    for (const to_compute of neighbors.filter(
      (x) => x.type == "FoldedEdge",
    )) {
      let new_edge = CalculateCost(to_compute);
      if (new_edge instanceof Error) {
        console.error(
          `Error calculating cost for edge ${to_compute.id}:`,
          new_edge.message,
        );
        continue;
      }
      console.log(`Calculated cost for edge ${to_compute.id}:`, new_edge);
      map.edges[new_edge.id] = new_edge;
    }

    let neighbors_calculated = Object.entries(map.edges)
      .filter(([edgeId, edge]) => edge.begin === old_path.node || edge.end === old_path.node)
      .map(([edgeId, edge]) => edge) as (
        | App.MapVCrossEdge
        | App.ComputedEdge
      )[];

    for (const neighbor of neighbors_calculated) {
      if (old_path.path.includes(neighbor.id)) continue;

      const new_cost = old_path.cost + calculateEdgeCost(neighbor, params);
      if (new_cost > state.min_cost) continue;

      new_paths.push({
        base_node: old_path.base_node,
        cost: new_cost,
        node: neighbor.begin === old_path.node ? neighbor.end : neighbor.begin,
        path: [...old_path.path, neighbor.id],
      });
    }
  }

  const unique_nodes = new_paths.reduce((acc, path) => {
    if (!acc.has(path.node)) {
      acc.set(path.node, path);
    } else {
      const existing_path = acc.get(path.node)!;
      if (path.cost < existing_path.cost) {
        acc.set(path.node, path);
      }
    }
    return acc;
  }, new Map<App.NodeId, SearchPath>());

  new_paths = Array.from(unique_nodes.values());

  return {
    paths: new_paths,
    min_cost: state.min_cost,
  };
}

export function generateInitSearchState(beginNodes: App.NodeId[]): SearchState {
  let paths: SearchPath[] = [];
  for (const node of beginNodes) {
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
  };
}

/**
 * @brief 経路探索を行う
 * @param graph 探索対象のグラフ
 * @param begin 探索開始地点
 * @param end 探索終了地点
 * @returns 経路の辺リスト
 */
export function pathFind(graph: App.SearchGraph, params: App.SearchParameters, begin: App.NodeId[], end: App.NodeId[]): App.EdgeId[] {
  let state = generateInitSearchState(begin);
  while (state.paths.length > 1) {
    state = step_search(graph, params, state, end);
  }
  if (state.paths.length === 0) {
    return [];
  }
  return state.paths[0].path;
}