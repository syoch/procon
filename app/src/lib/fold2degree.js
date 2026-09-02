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
  // 探索用グラフ（SearchGraph）のコンテナを準備
  /** @type {App.SearchGraph} */
  const searchGraph = {
    nodes: {},
    edges: {},
  };

  // 1. ノードのコピー（MapVCrossNode のみを抽出・登録）
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.type === "MapVCrossNode") {
      searchGraph.nodes[nodeId] = node;
    }
  }

  // 2. エッジの畳み込み・変換処理
  for (const [edgeId, edge] of Object.entries(graph.edges)) {
    // パターンA: 既に FoldedEdge の場合（または FoldedEdge へ畳み込む処理）
    if (edge.type === "OSMEdge") {
      // OSMEdge を FoldedEdge 構造へ変換（セグメント化）
      /** @type {App.FoldedEdge} */
      const foldedEdge = {
        type: "FoldedEdge",
        id: edge.id,
        begin: edge.begin,
        end: edge.end,
        segments: [
          {
            begin_coordinate: graph.nodes[edge.begin]?.coordinate ?? {
              lat: 0,
              lng: 0,
            },
            end_coordinate: graph.nodes[edge.end]?.coordinate ?? {
              lat: 0,
              lng: 0,
            },
            highway: edge.highway,
            width: edge.width,
            sidewalk: edge.sidewalk,
          },
        ],
      };

      /*console.log({
        FoldedEdgeに変換完了: true,
        id: foldedEdge.id,
        highway: foldedEdge.segments[0]?.highway,
        width: foldedEdge.segments[0]?.width,
        sidewalk: foldedEdge.segments[0]?.sidewalk,
      });*/

      searchGraph.edges[edgeId] = foldedEdge;

      // パターンB: MapVCrossEdge（交差点内部の仮想エッジ）の場合
    } else if (edge.type === "MapVCrossEdge") {
      console.log({
        MapVCrossEdgeを保持: true,
        id: edge.id,
        view_score: edge.view_score,
      });

      // MapVCrossEdge はその型のまま SearchGraph に保持
      searchGraph.edges[edgeId] = edge;
    }
  }

  // 3. 構築した SearchGraph 全体を返す
  console.log("searchGraph構築完了", searchGraph);
  return searchGraph;
}
