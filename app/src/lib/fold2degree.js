/**
 * @brief 安全に2度ノードを畳み込んで連結する修正版プログラム
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
    if (node.type === "MapVCrossNode") {
      searchGraph.nodes[nodeId] = node;
    }
  }

  // エッジの初期変換
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    if (edge.type === "OSMEdge") {
      /** @type {App.FoldedEdge} */
      const foldedEdge = {
        type: "FoldedEdge",
        id: edge.id,
        begin: edge.begin,
        end: edge.end,
        segments: [
          {
            begin_coordinate: graph.nodes[edge.begin]?.coordinate ?? { lat: 0, lng: 0 },
            end_coordinate: graph.nodes[edge.end]?.coordinate ?? { lat: 0, lng: 0 },
            highway: edge.highway,
            width: edge.width,
            sidewalk: edge.sidewalk,
          },
        ],
      };
      searchGraph.edges[edgeId] = foldedEdge;
    } else if (edge.type === "MapVCrossEdge") {
      searchGraph.edges[edgeId] = edge;
    }
  }

  // -------------------------------------------------------------
  // 【ステップ2】動的な畳み込み・連結処理
  // -------------------------------------------------------------

  // ヘルパー関数: 現在の searchGraph における各ノードの接続エッジ一覧を取得する
  const getAdjacency = () => {
    /** @type {Record<string, string[]>} */
    const adj = {};
    for (const [edgeId, edge] of Object.entries(searchGraph.edges)) {
      if (edge.type !== "FoldedEdge") continue;

      if (!adj[edge.begin]) adj[edge.begin] = [];
      if (!adj[edge.end]) adj[edge.end] = [];

      adj[edge.begin].push(edgeId);
      adj[edge.end].push(edgeId);
    }
    return adj;
  };

  let adj = getAdjacency();

  // 消去・連結対象となる「度数2の途中点ノード」のリストを作成
  const candidateNodeIds = Object.keys(graph.nodes).filter((nodeId) => {
    const isNotCross = graph.nodes[nodeId]?.type !== "MapVCrossNode";
    const isDegreeTwo = adj[nodeId]?.length === 2;
    return isNotCross && isDegreeTwo;
  });

  for (const nodeId of candidateNodeIds) {
    // 常に最新の接続状態を確認（前回の合体処理で変化している可能性があるため）
    const currentConnectedEdges = adj[nodeId];
    if (!currentConnectedEdges || currentConnectedEdges.length !== 2) continue;

    const [edgeId1, edgeId2] = currentConnectedEdges;

    const edge1 = searchGraph.edges[edgeId1];
    const edge2 = searchGraph.edges[edgeId2];

    // エッジがすでに削除されているか、同じエッジ同士（ループ）ならスキップ
    if (!edge1 || !edge2 || edgeId1 === edgeId2) continue;
    if (edge1.type !== "FoldedEdge" || edge2.type !== "FoldedEdge") continue;

    // --- 向きと端点の判定ロジック ---
    // edge1 において nodeId が終点側になるように揃える
    if (edge1.begin === nodeId) {
      edge1.segments.reverse();
      // 各 segment 内の始点・終点座標も入れ替え
      edge1.segments.forEach((seg) => {
        const tmp = seg.begin_coordinate;
        seg.begin_coordinate = seg.end_coordinate;
        seg.end_coordinate = tmp;
      });
      edge1.begin = edge1.end;
      edge1.end = nodeId;
    }

    // edge2 において nodeId が始点側になるように揃える
    let edge2Segments = JSON.parse(JSON.stringify(edge2.segments));
    let edge2OtherNode = edge2.end;

    if (edge2.end === nodeId) {
      edge2Segments.reverse();
      edge2Segments.forEach((seg) => {
        const tmp = seg.begin_coordinate;
        seg.begin_coordinate = seg.end_coordinate;
        seg.end_coordinate = tmp;
      });
      edge2OtherNode = edge2.begin;
    }

    // --- 合体処理 ---
    // 1. edge1 の終点を edge2 の反対側のノードに伸ばす
    edge1.end = edge2OtherNode;

    // 2. edge1 のセグメント群に edge2 のセグメント群を追加
    edge1.segments.push(...edge2Segments);

    // 3. 吸収された edge2 をグラフから消去
    delete searchGraph.edges[edgeId2];

    // 4. 動的追跡のため adj（隣接情報）をリアルタイム更新
    // edge2OtherNode に繋がっていた edgeId2 を edgeId1 に置き換える
    if (adj[edge2OtherNode]) {
      adj[edge2OtherNode] = adj[edge2OtherNode].map((id) => (id === edgeId2 ? edgeId1 : id));
    }
    // 消去された nodeId の情報はクリア
    delete adj[nodeId];
  }

  console.log("一本道への畳み込み・連結処理完了", searchGraph);
  return searchGraph;
}