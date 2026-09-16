// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// Reference Primitives
		type NodeId = string;
		type EdgeId = string;

		// Representation Primitives
		type Coordinate = {
			lng: number,
			lat: number
		};

		// Graph Primitives

		/**
		 *  OSM 地図上のノードを表す。
		 *
		 *  OSM からのデータ取得時は交差点を含め MapNode として取得するが、
		 * 交差点変換後は MapVCrossNode に変換される。
		 */
		type MapNode = {
			/** 型を識別するための固定値 */
			type: "MapNode",
			/** ノード識別子 */
			id: NodeId,
			/** 座標 */
			coordinate: Coordinate,
			/** 隣接するエッジの参照リスト */
			edges: EdgeId[]
		};

		/**
		 *  OSM 地図上のエッジを表す。
		 *
		 *  OSM からのデータ取得時は直線上の連続するエッジを統合せずに OSMEdge として取得する。
		 * 交差点において、交差点変換後は MapVCrossEdge に変換される。
		 * その他のエッジ (次数が 2 となる一本道を連結するエッジ) は foldDegree2Edges により FoldedEdge に変換される
		 */
		type OSMEdge = {
			/** 型を識別するための固定値 */
			type: "OSMEdge",
			/** エッジ識別子 */
			id: EdgeId;

			/** 始点ノード識別子 */
			begin: NodeId;
			/** 終点ノード識別子 */
			end: NodeId;

			/** OSM 上の道路の種類 */
			highway: string;
			/** OSM 上の幅員情報 */
			width: number | null;
			/** OSM 上の歩道情報 */
			sidewalk: string | null;
		};

		/** 交差点変換後の交差点を表すノード */
		type MapVCrossNode = {
			/** 型を識別するための固定値 */
			type: "MapVCrossNode",
			/** ノード識別子 */
			id: NodeId,

			/** 座標 */
			coordinate: Coordinate,
			/** 隣接するエッジの参照リスト */
			edges: EdgeId[],

			/** 交差点変換後のグループ化されたノードの参照リスト */
			group_nodes: NodeId[]
		};

		/** 交差点変換後の交差点において作成される仮想的なエッジ */
		type MapVCrossEdge = {
			/** 型を識別するための固定値 */
			type: "MapVCrossEdge",
			/** エッジ識別子 */
			id: EdgeId;

			/** 始点ノード識別子 */
			begin: NodeId;
			/** 終点ノード識別子 */
			end: NodeId;

			/** 回転半径より導出される視界スコア */
			view_score: number;
		};


		/**
		 * 次数畳み込みによって生成された部分的なエッジの情報 (セグメント)
		 */
		type Segment = {
			/** 始点の座標 */
			begin_coordinate: Coordinate,
			/** 終点の座標 */
			end_coordinate: Coordinate,
			/** OSM 上の道路の種類 */
			highway: string,
			/** OSM 上の幅員情報 */
			width: number | null,
			/** OSM 上の歩道情報 */
			sidewalk: string | null,
		}

		/**
		 * 次数が 2 のノードを畳み込んだエッジ
		 */
		type FoldedEdge = {
			/** 型を識別するための固定値 */
			type: "FoldedEdge",
			/** エッジ識別子 */
			id: EdgeId;

			/** 始点ノード識別子 */
			begin: NodeId;
			/** 終点ノード識別子 */
			end: NodeId;

			/** 経由するセグメントのリスト */
			segments: Segment[];
		};

		/** スコアが計算されたエッジ */
		type ComputedEdge = {
			/** 型を識別するための固定値 */
			type: "ComputedEdge",
			/** エッジ識別子 */
			id: EdgeId;

			/** 始点ノード識別子 */
			begin: NodeId;
			/** 終点ノード識別子 */
			end: NodeId;

			/** セグメント */
			segments: Segment[];

			/** スコア */
			width_score: number;
			/** スコア */
			view_score: number;
			/** スコア */
			mix_score: number;
		};

		type SplittedNode = {
			/** 型を識別するための固定値 */
			type: "SplittedNode",
			/** ノード識別子 */
			id: NodeId,
			/** 座標 */
			coordinate: Coordinate,
			/** 隣接するエッジの参照リスト */
			edges: EdgeId[],
		};

		// Graph Types
		/** OSM から取得したグラフ */
		type OSMGraph = {
			nodes: { [key: NodeId]: MapNode };
			edges: { [key: EdgeId]: OSMEdge };
		};

		/**
		 * 交差点変換後のグラフ
		 *
		 * crossConvert: OSMGraph -> CrossConvertedGraph
		 */
		type CrossConvertedGraph = {
			nodes: { [key: NodeId]: MapNode | MapVCrossNode };
			edges: { [key: EdgeId]: OSMEdge | MapVCrossEdge };
		};

		/**
		 * 次数 2 を畳み込んだ、探索用のグラフ
		 *
		 * deg(V) >= 3 となるノードは交差点変換されるので、MapVCrossNode となる。
		 * deg(V) = 2 となるノードは畳み込まれるので nodes の直和型には含まれない。
		 *
		 * fold2DegreeEdges: CrossConvertedGraph -> SearchGraph
		 */
		type SearchGraph = {
			nodes: { [key: NodeId]: MapVCrossNode | SplittedNode };
			edges: { [key: EdgeId]: MapVCrossEdge | FoldedEdge | ComputedEdge };
		};

		/**
		 * (デバッグ用途) 任意のノードとエッジを持つグラフ
		 *
		 * 主に DebugMapData/DebugGraphData で使用する。
		 */
		type GenericMap = {
			nodes: { [key: App.NodeId]: App.MapVCrossNode | App.MapNode};
			edges: {
				[key: App.EdgeId]:
				| App.OSMEdge
				| App.MapVCrossEdge
				| App.FoldedEdge
				| App.ComputedEdge;
			};
		};

		/**
		 * 経路探索パラメーター
		 */
		type SearchParameters = {
			mix_score_weight: number;
			view_score_weight: number;
			width_score_weight: number;
			lambda: number;
		};
	}
}

export { };
