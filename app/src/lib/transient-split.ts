import L from "leaflet"

function distance_point_to_edge(point: App.Coordinate, edge: [App.Coordinate, App.Coordinate], map?: L.Map): { distance: number, projection: App.Coordinate } | null {
  const [begin, end] = edge;

  const edge_dx = end.lat - begin.lat;
  const edge_dy = end.lng - begin.lng;
  const edge_length = Math.sqrt(edge_dx * edge_dx + edge_dy * edge_dy);
  if (edge_length === 0) {
    console.warn(`エッジの長さがゼロです: ${begin}, ${end}`);
    console.debug("point", point);
    console.debug("edge", edge);
    return null;
  }

  // 線分の方向ベクトル v
  //   v = \hat{(edge_dx, edge_dy)}
  const v_x = edge_dx / edge_length;
  const v_y = edge_dy / edge_length;

  // 線分の法線ベクトル n
  //   n = \hat{(-edge_dy, edge_dx)}
  const n_x = -v_y;
  const n_y = v_x;

  // 始点から point までのベクトル w
  //   w = (point.lat - start.lat, point.lng - start.lng)
  const w_x = point.lat - begin.lat;
  const w_y = point.lng - begin.lng;

  // w を v に射影した長さ t
  //   t = w・v
  const t = w_x * v_x + w_y * v_y;

  if (t < 0 || t > edge_length) {
    return null;
  }

  // 射影点の座標
  const proj_x = begin.lat + t * v_x;
  const proj_y = begin.lng + t * v_y;

  // 射影点から点までの距離
  //   d = w・n
  const distance = Math.abs(w_x * n_x + w_y * n_y);

  if (map) {
    // visualize w, d
    const p_point = L.circleMarker(point, { color: "blue", radius: 3 }).addTo(map);
    const d_line = L.polyline([point, { lat: proj_x, lng: proj_y }], { color: "red", weight: 1 }).addTo(map);

    setTimeout(() => {
      map.removeLayer(d_line);
      map.removeLayer(p_point);
    }, 100);
  }

  return { distance, projection: { lat: proj_x, lng: proj_y } };
}

function findNearestEdge(graph: App.SearchGraph, point: App.Coordinate, map?: L.Map): {
  edgeId: App.EdgeId;
  segment_index: number;
  distance: number;
  projection: App.Coordinate;
} | null {
  let nearestEdgeId: App.EdgeId | null = null;
  let minDistance = Infinity;
  let minProjection: App.Coordinate | null = null;
  let minSegmentIndex: number | null = null;

  const updateNearestEdge = (begin: App.Coordinate, end: App.Coordinate, edgeId: App.EdgeId, segmentIndex: number) => {
    const dist = distance_point_to_edge(point, [begin, end], map);
    if (dist && dist.distance < minDistance) {
      minDistance = dist.distance;
      nearestEdgeId = edgeId;
      minProjection = dist.projection;
      minSegmentIndex = segmentIndex;
    }
  }

  for (const edgeId in graph.edges) {
    const edge = graph.edges[edgeId];
    if (edge.type === "MapVCrossEdge") {
      continue;
    }
    if (edge.type === "ComputedEdge") {
      console.warn(`最近傍エッジの探索中に ComputedEdge が見つかりました: edgeId === ${edgeId}`);
      continue;
    }

    for (const subEdge of edge.segments) {
      const begin = subEdge.begin_coordinate;
      const end = subEdge.end_coordinate;
      updateNearestEdge(begin, end, edgeId, edge.segments.indexOf(subEdge));
    }
  }

  return nearestEdgeId && minProjection && minSegmentIndex !== null
    ? { edgeId: nearestEdgeId, segment_index: minSegmentIndex, distance: minDistance, projection: minProjection }
    : null;
}

export function transientSplit(graph: App.SearchGraph, point: App.Coordinate, map?: L.Map): [App.SearchGraph, App.NodeId] {
  const nearestEdge = findNearestEdge(graph, point, map);
  if (!nearestEdge) {
    throw new Error("垂線を下ろせるエッジが見つかりません");
  }

  const { edgeId, projection } = nearestEdge;
  const edge = graph.edges[edgeId];
  if (edge.type !== "FoldedEdge") {
    throw new Error(`最近傍エッジが FoldedEdge ではありません: edge.type === ${edge.type}`);
  }

  const segmentToSplit = edge.segments[nearestEdge.segment_index];

  const newNodeId = `transient-${Date.now()}`;
  const newEdgeId1 = `transient-edge-1-${Date.now()}`;
  const newEdgeId2 = `transient-edge-2-${Date.now()}`;

  const newNode: App.MapVCrossNode = { // TODO: これを表す型が必要。本来 VCrossNode ではない。
    type: "MapVCrossNode",
    id: newNodeId,
    coordinate: projection,
    edges: [newEdgeId1, newEdgeId2],
    group_nodes: [],
  };
  const newSegment1: App.Segment = {
    begin_coordinate: segmentToSplit.begin_coordinate,
    end_coordinate: projection,
    highway: segmentToSplit.highway,
    width: segmentToSplit.width,
    sidewalk: segmentToSplit.sidewalk,
  };
  const newSegment2: App.Segment = {
    begin_coordinate: projection,
    end_coordinate: segmentToSplit.end_coordinate,
    highway: segmentToSplit.highway,
    width: segmentToSplit.width,
    sidewalk: segmentToSplit.sidewalk,
  };
  const newEdge1: App.FoldedEdge = {
    type: "FoldedEdge",
    id: newEdgeId1,
    begin: edge.begin,
    end: newNodeId,
    segments: [
      ...edge.segments.slice(0, nearestEdge.segment_index),
      newSegment1
    ]
  };
  const newEdge2: App.FoldedEdge = {
    type: "FoldedEdge",
    id: newEdgeId2,
    begin: newNodeId,
    end: edge.end,
    segments: [
      newSegment2,
      ...edge.segments.slice(nearestEdge.segment_index + 1)
    ],
  };

  const newGraph: App.SearchGraph = {
    nodes: {
      ...graph.nodes,
      [newNodeId]: newNode,
    },
    edges: {
      ...graph.edges,
      [newEdgeId1]: newEdge1,
      [newEdgeId2]: newEdge2,
    }
  };
  delete newGraph.edges[edgeId]; // 元のエッジを削除する

  return [newGraph, newNodeId];
}
