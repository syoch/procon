/**
 * @brief 交差点変換後のグラフを探索用のグラフに変換する（畳み込み処理）
 * @param {App.CrossConvertedGraph} graph
 * @returns {App.SearchGraph | Error} 探索用グラフ
 */
export function fold2DegreeEdges(graph) {
  if (!graph || !graph.nodes || !graph.edges) {
    console.error("無効なグラフデータです。", graph);
    return new Error("無効なグラフデータです。");
  }

  // -------------------------------------------------------------
  // 【ステップ1】初期処理（ベースの生成）
  // -------------------------------------------------------------
  /** @type {App.SearchGraph} */
  const searchGraph = {
    nodes: {},
    edges: {},
  };

  // 交差点ノード (MapVCrossNode) のみを抽出
for (const [nodeId, node] of Object.entries(graph.nodes)) {
    // 1. 交差点ノードは必ず残す
    if (node.type === "MapVCrossNode") {
      searchGraph.nodes[nodeId] = JSON.parse(JSON.stringify(node));
      continue;
    }
    // 2. 次数が 2 以外の MapNode（行き止まりの次数1など）も残す
    if (node.edges && node.edges.length !== 2) {
      searchGraph.nodes[nodeId] = JSON.parse(JSON.stringify(node));
    }
  }

  // エッジの初期変換 (OSMEdge -> FoldedEdge)
for (const [edgeId, edge] of Object.entries(graph.edges)) {
  if (edge.type === "OSMEdge") {
    // 始点・終点のノードを取得し、無ければ警告を出す
    const beginNode = graph.nodes[edge.begin];
    if (!beginNode) {
      console.warn(`ノード ${edge.begin} が見つかりません。`);
    }

    const endNode = graph.nodes[edge.end];
    if (!endNode) {
      console.warn(`ノード ${edge.end} が見つかりません。`);
    }

    /** @type {App.FoldedEdge} */
    const foldedEdge = {
      type: "FoldedEdge",
      id: edge.id,
      begin: edge.begin,
      end: edge.end,
      segments: [
        {
          begin_coordinate: beginNode?.coordinate ?? { lat: 0, lng: 0 },
          end_coordinate: endNode?.coordinate ?? { lat: 0, lng: 0 },
          highway: edge.highway,
          width: edge.width,
          sidewalk: edge.sidewalk,
        },
      ],
    };
    searchGraph.edges[edgeId] = foldedEdge;
  } else if (edge.type === "MapVCrossEdge") {
    searchGraph.edges[edgeId] = JSON.parse(JSON.stringify(edge));
  }
}

  // -------------------------------------------------------------
  // 【ステップ2】畳み込み・連結処理 (graph.nodes[nodeId].edges を直接参照)
  // -------------------------------------------------------------
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    // 交差点ノード（MapVCrossNode）は統合対象外なのでスキップ
    if (node.type === "MapVCrossNode") continue;

    // 接続されているエッジが2本でない場合（端点や交差点など）はスキップ
    if (!node.edges || node.edges.length !== 2) continue;

    const [edgeId1, edgeId2] = node.edges;

    const edge1 = searchGraph.edges[edgeId1];
    const edge2 = searchGraph.edges[edgeId2];

    // エッジがすでに他の畳み込みで削除済みか、同じエッジ（ループ）ならスキップ
    if (!edge1 || !edge2 || edgeId1 === edgeId2) continue;
    // 交差点内部のエッジ(MapVCrossEdge)が含まれる場合は畳み込み対象外とし、そのまま残すためスキップ
    if (edge1.type !== "FoldedEdge" || edge2.type !== "FoldedEdge") continue;

    // --- 向きと端点の判定ロジック ---
    // edge1 において nodeId が終点側（end）になるように反転
    if (edge1.begin === nodeId) {
      edge1.segments.reverse();
      edge1.segments.forEach((seg) => {
        const tmp = seg.begin_coordinate;
        seg.begin_coordinate = seg.end_coordinate;
        seg.end_coordinate = tmp;
      });
      edge1.begin = edge1.end;
      edge1.end = nodeId;
    }

    // edge2 において nodeId が始点側（begin）になるように反転準備
    let edge2Segments = JSON.parse(JSON.stringify(edge2.segments));
    let edge2OtherNodeId = edge2.end;

    if (edge2.end === nodeId) {
      edge2Segments.reverse();
      edge2Segments.forEach((seg) => {
        const tmp = seg.begin_coordinate;
        seg.begin_coordinate = seg.end_coordinate;
        seg.end_coordinate = tmp;
      });
      edge2OtherNodeId = edge2.begin;
    }

    // --- 合体処理 ---
    // 1. edge1 の終点を edge2 の反対側のノードに伸ばす
    edge1.end = edge2OtherNodeId;

    // 2. edge1 のセグメント群に edge2 のセグメント群を追加
    edge1.segments.push(...edge2Segments);

    // 3. 吸収された edge2 をグラフから消去
    delete searchGraph.edges[edgeId2];

    // --- 【フィードバック反映：134行目相当】ノードの参照プロパティ更新 ---
//渡された graph は一切いじらず、searchGraph のノードだけを更新する
    const otherNodeInSearch = searchGraph.nodes[edge2OtherNodeId];
    if (otherNodeInSearch && otherNodeInSearch.edges) {
      otherNodeInSearch.edges = otherNodeInSearch.edges.map((eId) =>
        eId === edgeId2 ? edgeId1 : eId,
      );
    }
  }

  console.log("一本道への畳み込み・連結処理完了", searchGraph);
  return searchGraph;
}
