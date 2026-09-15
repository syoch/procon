export type Node = App.MapVCrossNode | App.MapNode;
export type Edge = App.OSMEdge
  | App.MapVCrossEdge
  | App.FoldedEdge
  | App.ComputedEdge;

export type Graph<NodeType extends Node, EdgeType extends Edge> = {
  nodes: Record<App.NodeId, NodeType>,
  edges: Record<App.EdgeId, EdgeType>,
};


export function assertGraph<N extends Node, E extends Edge>(assertTag: string, graph: Graph<N, E>) {
  // @ts-ignore
  if (!import.meta.env?.DEV ?? true) return;

  for (const edge of Object.values(graph.edges)) {
    const fromNode = graph.nodes[edge.begin];
    const toNode = graph.nodes[edge.end];

    if (!fromNode) throw new Error(`${assertTag}: Edge ${edge.id} has missing fromNode: ${edge.begin}`);
    if (!toNode) throw new Error(`${assertTag}: Edge ${edge.id} has missing toNode: ${edge.end}`);

    if (!fromNode.edges.includes(edge.id)) {
      throw new Error(`${assertTag}: Edge ${edge.id} is not referenced by fromNode ${fromNode.id}`);
    }
    if (!toNode.edges.includes(edge.id)) {
      throw new Error(`${assertTag}: Edge ${edge.id} is not referenced by toNode ${toNode.id}`);
    }
  }

  for (const node of Object.values(graph.nodes)) {
    for (const edgeId of node.edges) {
      const edge = graph.edges[edgeId];
      if (!edge) throw new Error(`${assertTag}: Node ${node.id} has missing edge: ${edgeId}`);

      if (edge.begin !== node.id && edge.end !== node.id) {
        throw new Error(`${assertTag}: Node ${node.id} references edge ${edge.id} but is not connected to it`);
      }
    }
  }
}

export function removeNode<N extends Node, E extends Edge>(graph: Graph<N, E>, nodeId: App.NodeId) {
  assertGraph("Before removeNode", graph);
  const node = graph.nodes[nodeId];
  if (!node) {
    throw new Error(`removeNode: Node ${nodeId} does not exist in graph`);
  }
  for (const edgeId of node.edges) {
    removeEdge(graph, edgeId);
  }
  delete graph.nodes[nodeId];
  assertGraph("After removeNode", graph);

}

export function removeEdge<N extends Node, E extends Edge>(graph: Graph<N, E>, edgeId: App.EdgeId) {
  if (!graph.edges[edgeId]) {
    throw new Error(`removeEdge: Edge ${edgeId} does not exist in graph`);
  }
  assertGraph("Before removeEdge", graph);
  delete graph.edges[edgeId];
  for (const node of Object.values(graph.nodes)) {
    node.edges = node.edges.filter(eid => eid !== edgeId);
  }
  assertGraph("After removeEdge", graph);

}

export function addNode<N extends Node, E extends Edge>(graph: Graph<N, E>, node: N) {
  if (graph.nodes[node.id]) {
    throw new Error(`addNode: Node ${node.id} already exists in graph`);
  }
  assertGraph("Before addNode", graph);
  graph.nodes[node.id] = node;
  assertGraph("After addNode", graph);

}

export function addEdge<N extends Node, E extends Edge>(graph: Graph<N, E>, edge: E) {
  if (!graph.nodes[edge.begin]) {
    throw new Error(`addEdge: Edge ${edge.id} has missing fromNode: ${edge.begin}`);
  }
  if (!graph.nodes[edge.end]) {
    throw new Error(`addEdge: Edge ${edge.id} has missing toNode: ${edge.end}`);
  }
  if (graph.edges[edge.id]) {
    throw new Error(`addEdge: Edge ${edge.id} already exists in graph`);
  }

  assertGraph("Before addEdge", graph);

  const fromNode = graph.nodes[edge.begin];
  const toNode = graph.nodes[edge.end];

  graph.edges[edge.id] = edge;
  fromNode.edges.push(edge.id);

  // ループ時でない場合にのみ toNode にエッジを追加する
  // ループ時においては fromNode, toNode の区別はないため、どちらでも良いが片方にのみ追加するようにする
  if (edge.begin !== edge.end) {
    toNode.edges.push(edge.id);
  }

  assertGraph("After addEdge", graph);

}

/**
 * グラフを変換する
 *
 * @param graph 変換対象のグラフ
 * @param nodeTransformer ノードを変換する関数 (引数で与えられるノードは変更しないこと)
 * @param edgeTransformer エッジを変換する関数 (引数で与えられるエッジは変更しないこと)
 * @returns 変換後のグラフ
 */
export function transformGraph<
  N1 extends Node, E1 extends Edge, N2 extends Node, E2 extends Edge
>(graph: Graph<N1, E1>, nodeTransformer: (node: N1) => N2, edgeTransformer: (edge: E1) => E2): Graph<N2, E2> {

  assertGraph("Before transformGraph", graph);

  const newGraph: Graph<N2, E2> = {
    nodes: Object.fromEntries(Object.entries(graph.nodes).map(([nodeId, node]) => [nodeId, nodeTransformer(node)])),
    edges: Object.fromEntries(Object.entries(graph.edges).map(([edgeId, edge]) => [edgeId, edgeTransformer(edge)])),
  };

  assertGraph("After transformGraph", newGraph);
  return newGraph;
}
