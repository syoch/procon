import { addEdge, removeNode, transformGraph } from "./utils/graph";
import { combineDirection, flipDirection } from "./utils/direction";


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
  let searchGraph = transformGraph(graph,
    (node) => node,
    (edge) => {
      if (edge.type === "MapVCrossEdge") {
        return edge;
      }

      const beginNode = graph.nodes[edge.begin];
      const endNode = graph.nodes[edge.end];
      if (!beginNode || !endNode) {
        throw new Error(`Processing ${edge.id} Aborted by corrupted graph. Missing nodes: ${edge.begin}, ${edge.end}`);
      }

      /** @type {App.FoldedEdge} */
      const foldedEdge = {
        type: "FoldedEdge",
        id: edge.id,
        begin: edge.begin,
        end: edge.end,
        direction: edge.direction,
        segments: [
          {
            begin_coordinate: beginNode.coordinate,
            end_coordinate: endNode.coordinate,
            highway: edge.highway,
            width: edge.width,
            sidewalk: edge.sidewalk,
            maxspeed: edge.maxspeed ?? null,
            lanes: edge.lanes ?? null,
          },
        ],
      };

      return foldedEdge;
    }
  );

  // -------------------------------------------------------------
  // 【ステップ2】畳み込み・連結処理 (graph.nodes[nodeId].edges を直接参照)
  // -------------------------------------------------------------
  // 変換対象は 2 本の FoldedEdge が接続されている MapNode
  for (const nodeId of Object.keys(searchGraph.nodes)) {
    const node = searchGraph.nodes[nodeId];
    if (node.type !== "MapNode") {
      continue;
    }
    if (node.edges.length === 0) {
      removeNode(searchGraph, nodeId);
      continue;
    }
    if (node.edges.length === 1) {
      // 次数1は行き止まり(葉)。唯一のエッジを保持したまま、型だけ MapVCrossNode に差し替える。
      // removeNode すると唯一のエッジまで削除され、孤立ノードになったり接続先の道路が欠落する。
      searchGraph.nodes[nodeId] = {
        ...node,
        type: "MapVCrossNode",
        group_nodes: [nodeId],
      };
      continue;
    }

    const [edgeId1, edgeId2] = node.edges;

    const edge1 = searchGraph.edges[edgeId1];
    const edge2 = searchGraph.edges[edgeId2];
    if (!edge1 || !edge2) {
      throw new Error(`Processing ${nodeId} ${node.type} Aborted by corrupted graph. Missing edges: ${edgeId1}, ${edgeId2}`);
    }

    // 同じエッジ（ループ）ならスキップ
    if (edgeId1 === edgeId2) {
      continue;
    }
    // 畳み込み対象は FoldedEdge 同士なので、そうでない場合はスキップ
    if (edge1.type !== "FoldedEdge" || edge2.type !== "FoldedEdge") {
      continue;
    }

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
      // 反転すると進行可能な向きも逆になる
      edge1.direction = flipDirection(edge1.direction);
    }

    // edge2 において nodeId が始点側（begin）になるように反転準備
    let edge2Segments = edge2.segments;
    let edge2OtherNodeId = edge2.end;
    let edge2Direction = edge2.direction;

    if (edge2.end === nodeId) {
      edge2Segments = edge2Segments.toReversed().map((seg) => {
        return {
          ...seg,
          begin_coordinate: seg.end_coordinate,
          end_coordinate: seg.begin_coordinate,
        };
      });
      edge2OtherNodeId = edge2.begin;
      edge2Direction = flipDirection(edge2.direction);
    }

    /** @type {App.FoldedEdge} */
    const newEdge = {
      type: "FoldedEdge",
      id: edge1.id,
      begin: edge1.begin,
      end: edge2OtherNodeId,
      // 連結方向に対して両エッジが通行可能なときだけ通行可能にする
      direction: combineDirection(edge1.direction, edge2Direction),
      segments: [...edge1.segments, ...edge2Segments],
    };

    removeNode(searchGraph, nodeId);
    addEdge(searchGraph, newEdge);
  }

  // 型推論のために、MapNode が残っていないかチェック
  /** @type {App.SearchGraph} */
  const result = searchGraph = {
    nodes: Object.fromEntries(
      Object.entries(searchGraph.nodes)
        .map(([nodeId, node]) => {
          if (node.type === "MapNode") {
            console.log(nodeId, node, searchGraph)
            throw new Error(`畳み込み後のグラフに MapNode が残っています。nodeId: ${nodeId}`);
          }
          return [nodeId, node];
        })
    ),
    edges: searchGraph.edges,
  }
  return result;
}
