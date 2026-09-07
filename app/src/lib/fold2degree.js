/**
 * @brief 交差点変換後のグラフを探索用のグラフに変換する
 * @param {App.CrossConvertedGraph} graph
 * @returns {App.SearchGraph | Error} 探索用グラフ
 */
export function fold2DegreeEdges(graph) {
  if (!graph || !graph.nodes || !graph.edges) {
    console.error("無効なグラフデータです。", graph);
    return new Error("無効なグラフデータです。");
  }

  // -------------------------------------------------------------
  // 【ステップ1】元のプログラムと同じ初期処理（ベースの生成）
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

  // エッジの初期変換 (OSMEdge -> FoldedEdge, MapVCrossEdge はそのまま保持)
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
  // 【ステップ2】交差点以外の点（2度のノード）を通るエッジの畳み込み・連結処理
  // -------------------------------------------------------------

  // 2-1. 各ノードに接続している「OSM由来エッジ（FoldedEdge）」をカウント・リスト化
  /** @type {Record<string, Array<{ edgeId: string, isBegin: boolean }>>} */
  const nodeAdjacency = {};

  for (const [edgeId, edge] of Object.entries(searchGraph.edges)) {
    if (edge.type !== "FoldedEdge") continue;

    if (!nodeAdjacency[edge.begin]) nodeAdjacency[edge.begin] = [];
    if (!nodeAdjacency[edge.end]) nodeAdjacency[edge.end] = [];

    nodeAdjacency[edge.begin].push({ edgeId, isBegin: true });
    nodeAdjacency[edge.end].push({ edgeId, isBegin: false });
  }

  // 処理済み（連結されて削除対象となった）エッジのIDセット
  const removedEdgeIds = new Set();

  // 2-2. 接続数がちょうど2本（一本道の途中点）のノードを探して連結処理を行う
  for (const [nodeId, connections] of Object.entries(nodeAdjacency)) {
    // 交差点（MapVCrossNode）は絶対に消さない
    if (graph.nodes[nodeId]?.type === "MapVCrossNode") continue;

    // 接続しているエッジがちょうど2本でない場合はスキップ（端点や3差路以上など）
    if (connections.length !== 2) continue;

    const conn1 = connections[0];
    const conn2 = connections[1];

    // すでにどちらかのエッジが他の連結処理で統合・削除されている場合はスキップ
    if (removedEdgeIds.has(conn1.edgeId) || removedEdgeIds.has(conn2.edgeId)) continue;
    if (conn1.edgeId === conn2.edgeId) continue; // 自己ループ等の防止

    const edge1 = searchGraph.edges[conn1.edgeId];
    const edge2 = searchGraph.edges[conn2.edgeId];

    if (!edge1 || !edge2 || edge1.type !== "FoldedEdge" || edge2.type !== "FoldedEdge") continue;

    // 2-3. edge1 の末尾に edge2 をガッチャンコ（連結）する
    // edge1 と edge2 の向き（begin/end）がどう接しているか判定して配列を調整
    let edge2Segments = [...edge2.segments];

    // edge2 の始まりが共通ノード(nodeId)でない場合、順序を反転させる
    const edge2StartNode = conn2.isBegin ? edge2.begin : edge2.end;
    if (edge2StartNode !== nodeId) {
      edge2Segments.reverse();
    }

    // edge1 の終わりが共通ノード(nodeId)でない場合、edge1の既存セグメントを反転させて終点を揃える
    const edge1EndNode = conn1.isBegin ? edge1.begin : edge1.end;
    if (edge1EndNode !== nodeId) {
      edge1.segments.reverse();
      edge1.begin = edge1EndNode;
    }

    // edge1 の新しい終点を edge2 の反対側のノードに更新
    const edge2OtherNode = conn2.isBegin ? edge2.end : edge2.begin;
    edge1.end = edge2OtherNode;

    // セグメント配列を合体
    edge1.segments.push(...edge2Segments);

    // 統合された edge2 を削除対象に追加
    removedEdgeIds.add(conn2.edgeId);

    // nodeAdjacency の接続情報を更新（edge2OtherNode 側の参照を edge2 から edge1 に差し替え）
    const otherConnections = nodeAdjacency[edge2OtherNode];
    if (otherConnections) {
      for (const conn of otherConnections) {
        if (conn.edgeId === conn2.edgeId) {
          conn.edgeId = conn1.edgeId;
          conn.isBegin = (edge1.begin === edge2OtherNode);
        }
      }
    }
  }

  // 2-4. 統合されて不要になったエッジを searchGraph.edges から除去
  for (const edgeId of removedEdgeIds) {
    delete searchGraph.edges[edgeId];
  }

  console.log("一本道への畳み込み・連結処理完了", searchGraph);
  return searchGraph;
}