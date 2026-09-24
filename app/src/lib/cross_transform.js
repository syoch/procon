import { addEdge, addNode } from "./utils/graph";

/**
 * @brief 交差点変換後のグラフにおける交差点の視認性スコアを計算する。
 *
 * @param {App.Coordinate} beginCoordinate 進入側の隣接ノードの座標
 * @param {App.Coordinate} intersectionCoordinate 交差点の座標
 * @param {App.Coordinate} endCoordinate 退出側の隣接ノードの座標
 * @returns {number} 視界スコア（0.0 〜 1.0）
 */
function calculateViewScore(beginCoordinate, intersectionCoordinate, endCoordinate) {
  const approachLng = intersectionCoordinate.lng - beginCoordinate.lng;
  const approachLat = intersectionCoordinate.lat - beginCoordinate.lat;
  const departureLng = endCoordinate.lng - intersectionCoordinate.lng;
  const departureLat = endCoordinate.lat - intersectionCoordinate.lat;

  const approachLength = Math.hypot(approachLng, approachLat);
  const departureLength = Math.hypot(departureLng, departureLat);
  if (approachLength === 0 || departureLength === 0) {
    // 座標が縮退している場合は回頭を判定できないため、回頭なしとして扱う
    return 1.0;
  }

  const cosTheta =
    (approachLng * departureLng + approachLat * departureLat) /
    (approachLength * departureLength);
  const theta = Math.acos(Math.min(Math.max(cosTheta, -1), 1));

  // theta = 0 で 1, theta = π (U ターン) で 0 となるようにスコアを計算する
  return 1.0 - theta / Math.PI;
}

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
    const intersectionCoordinate = osmGraph.nodes[nodeId].coordinate;
    for (const neighborNodeId of neighborNodes) {
      const newNodeId = `${nodeId}_${neighborNodeId}`;
      addNode(newGraph, {
        type: "MapVCrossNode",
        id: newNodeId,
        coordinate: intersectionCoordinate,
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
          view_score: calculateViewScore(
            osmGraph.nodes[neighborNodeId1].coordinate,
            intersectionCoordinate,
            osmGraph.nodes[neighborNodeId2].coordinate
          ),
          // 交差点内部の移動は両方向に通行可能とする (進入・退出エッジ側の direction で制限される)
          direction: "both",
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