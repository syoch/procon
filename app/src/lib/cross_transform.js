import { addEdge, addNode } from "./utils/graph";

/**
 * @brief OSM から取得したグラフに対して交差点変換を行う。
 * @param {App.OSMGraph} osmGraph
 * @returns {App.CrossConvertedGraph | Error} 交差点変換後のグラフ
 */
export function CrossConvert(osmGraph) {
  /** @type {App.CrossConvertedGraph} */
  let newGraph = {
    nodes: {},
    edges: {},
  };


  const crossingNodes = new Set();
  for (const [nodeId, node] of Object.entries(osmGraph.nodes)) {
    if (node.edges.length <= 2) {
      addNode(newGraph, { ...node, edges: [] });
      continue;
    }

    crossingNodes.add(nodeId);

    const neighborNodes = node.edges.map(edgeId => {
      const edge = osmGraph.edges[edgeId];
      return edge.begin === nodeId ? edge.end : edge.begin;
    });
    for (const neighborNodeId of neighborNodes) {
      const newNodeId = `${nodeId}_${neighborNodeId}`;
      addNode(newGraph, {
        type: "MapVCrossNode",
        id: newNodeId,
        coordinate: osmGraph.nodes[nodeId].coordinate,
        edges: [],
        group_nodes: neighborNodes,
      });
    }

    for (let i = 0; i < neighborNodes.length; i++) {
      for (let j = i + 1; j < neighborNodes.length; j++) {
        const neighborNodeId1 = neighborNodes[i];
        const neighborNodeId2 = neighborNodes[j];
        const newNodeId1 = `${nodeId}_${neighborNodeId1}`;
        const newNodeId2 = `${nodeId}_${neighborNodeId2}`;

        addEdge(newGraph, {
          type: "MapVCrossEdge",
          begin: newNodeId1,
          end: newNodeId2,
          id: `${newNodeId1}_${newNodeId2}`,
          view_score: 1,
        });
      }
    }
  }

  for (const [edgeId, edge] of Object.entries(osmGraph.edges)) {
    const isBeginCrossing = crossingNodes.has(edge.begin);
    const isEndCrossing = crossingNodes.has(edge.end);

    const beginNodeId = isBeginCrossing ? `${edge.begin}_${edge.end}` : edge.begin;
    const endNodeId = isEndCrossing ? `${edge.end}_${edge.begin}` : edge.end;

    addEdge(newGraph, {
      ...edge,
      begin: beginNodeId,
      end: endNodeId,
    });
  }

  return newGraph;
}