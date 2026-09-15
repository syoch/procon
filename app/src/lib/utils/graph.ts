type Node = App.MapVCrossNode | App.MapNode;
type Edge = App.OSMEdge
  | App.MapVCrossEdge
  | App.FoldedEdge
  | App.ComputedEdge;

type Graph<NodeType extends Node, EdgeType extends Edge> = {
  nodes: Record<App.NodeId, NodeType>,
  edges: Record<App.EdgeId, EdgeType>,
};


export function assertGraph<N extends Node, E extends Edge>(assertTag: string, graph: Graph<N, E>) {
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

export function removeNode<N extends Node, E extends Edge>(graph: Graph<N, E>, nodeId: App.NodeId): Graph<N, E> {
  assertGraph("Before removeNode", graph);
  const newGraph = { ...graph };
  for (const edgeId of graph.nodes[nodeId].edges) {
    removeEdge(newGraph, edgeId);
  }
  delete newGraph.nodes[nodeId];
  assertGraph("After removeNode", newGraph);
  return newGraph;
}

export function removeEdge<N extends Node, E extends Edge>(graph: Graph<N, E>, edgeId: App.EdgeId): Graph<N, E> {
  assertGraph("Before removeEdge", graph);
  const newGraph = { ...graph };
  delete newGraph.edges[edgeId];
  for (const node of Object.values(newGraph.nodes)) {
    node.edges = node.edges.filter(eid => eid !== edgeId);
  }
  assertGraph("After removeEdge", newGraph);
  return newGraph;
}

export function addNode<N extends Node, E extends Edge>(graph: Graph<N, E>, node: N): Graph<N, E> {
  assertGraph("Before addNode", graph);
  const newGraph = { ...graph };
  newGraph.nodes[node.id] = node;
  assertGraph("After addNode", newGraph);
  return newGraph;
}

export function addEdge<N extends Node, E extends Edge>(graph: Graph<N, E>, edge: E): Graph<N, E> {
  if (!graph.nodes[edge.begin]) {
    throw new Error(`addEdge: Edge ${edge.id} has missing fromNode: ${edge.begin}`);
  }
  if (!graph.nodes[edge.end]) {
    throw new Error(`addEdge: Edge ${edge.id} has missing toNode: ${edge.end}`);
  }

  assertGraph("Before addEdge", graph);

  const newGraph = { ...graph };
  const fromNode = newGraph.nodes[edge.begin];
  const toNode = newGraph.nodes[edge.end];

  newGraph.edges[edge.id] = edge;
  fromNode.edges.push(edge.id);
  toNode.edges.push(edge.id);

  assertGraph("After addEdge", newGraph);
  return newGraph;
}

export function transformGraph<
  N1 extends Node, E1 extends Edge, N2 extends Node, E2 extends Edge
>(graph: Graph<N1, E1>, nodeTransformer: (node: N1) => N2, edgeTransformer: (edge: E1) => E2): Graph<N2, E2> {

  assertGraph("Before transformGraph", graph);

  const newGraph: Graph<N2, E2> = {
    nodes: Object.fromEntries(Object.entries(graph.nodes).map(([nodeId, node]) => [nodeId, nodeTransformer(structuredClone(node))])),
    edges: Object.fromEntries(Object.entries(graph.edges).map(([edgeId, edge]) => [edgeId, edgeTransformer(structuredClone(edge))])),
  };

  assertGraph("After transformGraph", newGraph);
  return newGraph;
}