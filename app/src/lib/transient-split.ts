import { addEdge, addNode, removeEdge } from "./utils/graph";

/**
 * 点から線分への最短距離と、線分上の最も近い点 (射影点) を求める
 *
 * 経度 1° の長さは緯度 1° の cos(緯度) 倍しかないため、経度方向の差に cos(緯度) を掛けてから計算する
 * (掛けないと東西方向の距離を長く見積もり、近い道より遠い道を選んでしまう)。
 * 返す distance はこの補正後の「度」単位で、候補同士の比較にだけ使う。
 */
function distance_point_to_edge(point: App.Coordinate, edge: [App.Coordinate, App.Coordinate]): { distance: number, projection: App.Coordinate } | null {
  const [begin, end] = edge;

  // 経度方向の縮み (cos(緯度))
  const k = Math.cos(point.lat * Math.PI / 180);

  const edge_dx = end.lat - begin.lat;
  const edge_dy = (end.lng - begin.lng) * k;
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
  const w_y = (point.lng - begin.lng) * k;

  // w を v に射影した長さ t
  //   t = w・v
  // 垂線の足が線分の外に落ちる場合は、近い方の端点を最も近い点とする
  // (道の曲がり角の外側にある点は、どの区間にも垂線の足が落ちないため、除外すると近くの道に吸着できない)
  const t_raw = w_x * v_x + w_y * v_y;
  const t = Math.min(Math.max(t_raw, 0), edge_length);

  // 射影点の座標
  const proj_x = begin.lat + t * v_x;
  const proj_y = begin.lng + (t * v_y) / k;

  // 射影点から点までの距離
  //   垂線の足が線分の内側: d = |w・n|
  //   端点を使う場合:       d = |w - t・v|
  const distance = t === t_raw
    ? Math.abs(w_x * n_x + w_y * n_y)
    : Math.hypot(w_x - t * v_x, w_y - t * v_y);

  return { distance, projection: { lat: proj_x, lng: proj_y } };
}

/**
 * @param allowedEdges 指定した場合、この集合に含まれるエッジだけを吸着の候補にする
 */
export function findNearestEdge(graph: App.SearchGraph, point: App.Coordinate, allowedEdges?: Set<App.EdgeId>): {
  edgeId: App.EdgeId;
  segment_index: number; // ComputedEdge の場合は -1 となる
  distance: number;
  projection: App.Coordinate;
} | null {
  let nearestEdgeId: App.EdgeId | null = null;
  let minDistance = Infinity;
  let minProjection: App.Coordinate | null = null;
  let minSegmentIndex: number | null = null;

  const updateNearestEdge = (begin: App.Coordinate, end: App.Coordinate, edgeId: App.EdgeId, segmentIndex: number) => {
    const dist = distance_point_to_edge(point, [begin, end]);
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
    if (allowedEdges && !allowedEdges.has(edgeId)) {
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

/**
 * @param allowedEdges 指定した場合、この集合に含まれるエッジだけに吸着する。
 *   分割したエッジが集合に含まれていた場合、分割後の 2 エッジを集合に追加する
 *   (同じエッジ上に始点・終点がある場合に、2 回目の分割で候補から外れないようにするため)
 */
export function transientSplit(graph: App.SearchGraph, point: App.Coordinate, allowedEdges?: Set<App.EdgeId>): App.NodeId {
  const nodeId = `tr-${point.lat}-${point.lng}`;

  // すでに同じ場所に分割ノードが存在する場合は何もしない
  if (graph.nodes[nodeId]) {
    return nodeId;
  }

  const nearestEdge = findNearestEdge(graph, point, allowedEdges);
  if (!nearestEdge) {
    throw new Error("垂線を下ろせるエッジが見つかりません");
  }

  const { edgeId, projection } = nearestEdge;
  const edge = graph.edges[edgeId];

  if (edge.type === "MapVCrossEdge") {
    throw new Error("MapVCrossEdge は分割できません");
  }

  const segmentToSplit = edge.segments[nearestEdge.segment_index];

  const newEdgeId1 = `${nodeId}-t1`;
  const newEdgeId2 = `${nodeId}-t2`;

  const newNode: App.SplittedNode = {
    type: "SplittedNode",
    id: nodeId,
    coordinate: projection,
    edges: []
  };
  const newSegment1: App.Segment = {
    begin_coordinate: segmentToSplit.begin_coordinate,
    end_coordinate: projection,
    highway: segmentToSplit.highway,
    width: segmentToSplit.width,
    sidewalk: segmentToSplit.sidewalk,
<<<<<<< HEAD
=======
    maxspeed: segmentToSplit.maxspeed,
    lanes: segmentToSplit.lanes,
>>>>>>> 1bc1565dd005c119a8746fcb46734f5077eb9330
    tags: segmentToSplit.tags,
  };
  const newSegment2: App.Segment = {
    begin_coordinate: projection,
    end_coordinate: segmentToSplit.end_coordinate,
    highway: segmentToSplit.highway,
    width: segmentToSplit.width,
    sidewalk: segmentToSplit.sidewalk,
<<<<<<< HEAD
=======
    maxspeed: segmentToSplit.maxspeed,
    lanes: segmentToSplit.lanes,
>>>>>>> 1bc1565dd005c119a8746fcb46734f5077eb9330
    tags: segmentToSplit.tags,
  };

  const newEdge1 = {
    id: newEdgeId1,
    begin: edge.begin,
    end: nodeId,
    direction: edge.direction,
    segments: [
      ...edge.segments.slice(0, nearestEdge.segment_index),
      newSegment1
    ],

    ...edge.type === "ComputedEdge" ? {
      type: "ComputedEdge" as const,
      width_score: edge.width_score,
      view_score: edge.view_score,
      mix_score: edge.mix_score,
    } : {
      type: "FoldedEdge" as const,
    }
  };

  const newEdge2 = {
    id: newEdgeId2,
    begin: nodeId,
    end: edge.end,
    direction: edge.direction,
    segments: [
      newSegment2,
      ...edge.segments.slice(nearestEdge.segment_index + 1)
    ],
    ...edge.type === "ComputedEdge" ? {
      type: "ComputedEdge" as const,
      width_score: edge.width_score,
      view_score: edge.view_score,
      mix_score: edge.mix_score,
    } : {
      type: "FoldedEdge" as const,
    }
  };

  addNode(graph, newNode);
  removeEdge(graph, edgeId);
  addEdge(graph, newEdge1);
  addEdge(graph, newEdge2);

  if (allowedEdges?.has(edgeId)) {
    allowedEdges.delete(edgeId);
    allowedEdges.add(newEdgeId1);
    allowedEdges.add(newEdgeId2);
  }

  return nodeId;
}
