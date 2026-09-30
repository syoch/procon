import { expect, test, vi } from "vitest";
import { pathToCoordinates } from "../../src/routes/api/path-find/pathFind";

// Node 上では leaflet が window を要求するため、距離計算だけのスタブに差し替える
vi.mock("leaflet", async () => await import("../mocks/leaflet"));

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function crossNode(id: App.NodeId, lat: number): App.MapVCrossNode {
	return { type: "MapVCrossNode", id, coordinate: { lat, lng: 0 }, edges: [], group_nodes: [id] };
}

/**
 * fold2DegreeEdges が保証する以下の不変条件を満たす ComputedEdge を生成する。
 *   segments[0].begin_coordinate === nodes[begin].coordinate
 *   segments[n-1].end_coordinate === nodes[end].coordinate
 *   segments[i].end_coordinate === segments[i+1].begin_coordinate
 *
 * 中間点は beginLat と endLat の間に等間隔で配置する。begin/end は
 * *ストレージ上の向き* であり、走行方向とは独立に決まる。
 */
function compEdge(
	id: App.EdgeId,
	begin: App.NodeId,
	beginLat: number,
	end: App.NodeId,
	endLat: number,
	interiorCount = 0,
): App.ComputedEdge {
	const points: number[] = [beginLat];
	for (let i = 1; i <= interiorCount; i++) {
		points.push(beginLat + ((endLat - beginLat) * i) / (interiorCount + 1));
	}
	points.push(endLat);

	return {
		type: "ComputedEdge",
		id,
		begin,
		end,
		direction: "both",
		segments: points.slice(0, -1).map((lat, i) => ({
			begin_coordinate: { lat, lng: 0 },
			end_coordinate: { lat: points[i + 1], lng: 0 },
			highway: "residential",
			width: 3,
			sidewalk: "both",
		})),
		width_score: 0,
		view_score: 0,
		mix_score: 0,
	};
}

function mapVCrossEdge(id: App.EdgeId, begin: App.NodeId, end: App.NodeId): App.MapVCrossEdge {
	return { type: "MapVCrossEdge", id, begin, end, direction: "both", view_score: 0 };
}

/** nodes[edge.begin/end].edges が整ったグラフを作る */
function graph(
	nodes: Record<string, App.MapVCrossNode>,
	edges: App.SearchGraph["edges"],
): App.SearchGraph {
	const g: App.SearchGraph = { nodes, edges };
	for (const e of Object.values(g.edges)) {
		g.nodes[e.begin].edges.push(e.id);
		if (e.begin !== e.end) g.nodes[e.end].edges.push(e.id);
	}
	return g;
}

/**
 * 2 本の ComputedEdge と 2 つのノードを持つ最小グラフ。
 * ストレージ上の向きは beginNode(0) -> endNode(2) で固定。
 * 走行方向は beginNode から始めるか endNode から始めるかで選べる。
 * つまり同じグラフを「順方向」「逆方向」の両方で走れる。
 */
function singleLine() {
	const nodes = { P: crossNode("P", 0), Q: crossNode("Q", 2) };
	const edges = { PQ: compEdge("PQ", "P", 0, "Q", 2, 1) }; // 中間点は Q = 1
	return graph(nodes, edges);
}

const lats = (points: App.Coordinate[]) => points.map((p) => p.lat);

// ---------------------------------------------------------------------------
// 方向の表現
// ---------------------------------------------------------------------------

test("edgeIds が空なら始点ノードの座標だけを返す", () => {
	expect(lats(pathToCoordinates(singleLine(), [], "P"))).toEqual([0]);
});

test("順方向: 中間点と終端ノードを走行順に返す", () => {
	expect(lats(pathToCoordinates(singleLine(), ["PQ"], "P"))).toEqual([0, 1, 2]);
});

test("逆方向: セグメントを逆順に戻して遠方ノードまで到達する", () => {
	// ストレージは P -> Q。begin=Q からなら PQ は逆走になる。
	// 遠方ノード P(0) が省略されないことが重要（省略されると 1 が重複する）。
	expect(lats(pathToCoordinates(singleLine(), ["PQ"], "Q"))).toEqual([2, 1, 0]);
});

test("単一セグメントの ComputedEdge を逆走しても遠方ノードに到達する", () => {
	const g = graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1) },
		{ PQ: compEdge("PQ", "P", 0, "Q", 1, 0) },
	);
	expect(lats(pathToCoordinates(g, ["PQ"], "Q"))).toEqual([1, 0]);
});

test("MapVCrossEdge は遠方ノードの座標を返す", () => {
	const g = graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1) },
		{ PQ: mapVCrossEdge("PQ", "P", "Q") },
	);
	expect(lats(pathToCoordinates(g, ["PQ"], "P"))).toEqual([0, 1]);
});

test("MapVCrossEdge を逆走しても遠方ノードの座標を返す", () => {
	const g = graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1) },
		{ PQ: mapVCrossEdge("PQ", "P", "Q") },
	);
	expect(lats(pathToCoordinates(g, ["PQ"], "Q"))).toEqual([1, 0]);
});

// ---------------------------------------------------------------------------
// 複数エッジの連結
// ---------------------------------------------------------------------------

/** P(0) -- Q(1) -- R(2)。ストレージ: PQ は P->Q、QR は R->Q。 */
function twoEdges() {
	return graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1), R: crossNode("R", 2) },
		{
			PQ: compEdge("PQ", "P", 0, "Q", 1),
			RQ: compEdge("RQ", "R", 2, "Q", 1),
		},
	);
}

test("前半が順方向・後半が逆方向", () => {
	// P -> Q は PQ の順走、Q -> R は RQ の逆走。終端 R まで到達する。
	expect(lats(pathToCoordinates(twoEdges(), ["PQ", "RQ"], "P"))).toEqual([0, 1, 2]);
});

test("前半が逆方向・後半が順方向", () => {
	// R -> Q は RQ の順走、Q -> P は PQ の逆走
	expect(lats(pathToCoordinates(twoEdges(), ["RQ", "PQ"], "R"))).toEqual([2, 1, 0]);
});

test("2 エッジとも逆方向", () => {
	const g = graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1), R: crossNode("R", 2) },
		{
			QP: compEdge("QP", "Q", 1, "P", 0),
			QR: compEdge("QR", "Q", 1, "R", 2),
		},
	);
	// R -> Q は QR の逆走、Q -> P は QP の逆走
	expect(lats(pathToCoordinates(g, ["QR", "QP"], "R"))).toEqual([2, 1, 0]);
});

/** MapVCrossEdge と ComputedEdge が混在し、後者が逆走する経路。 */
function mixedEdges() {
	return graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1), R: crossNode("R", 2) },
		{
			PQ: mapVCrossEdge("PQ", "P", "Q"), // ストレージ P->Q (順走)
			RQ: compEdge("RQ", "R", 2, "Q", 1), // ストレージ R->Q (Q からは逆走)
		},
	);
}

test("MapVCrossEdge を順走してから ComputedEdge を逆走する", () => {
	// P -> Q は MapVCrossEdge の順走、Q -> R は RQ の逆走
	expect(lats(pathToCoordinates(mixedEdges(), ["PQ", "RQ"], "P"))).toEqual([0, 1, 2]);
});

test("ComputedEdge を逆走してから MapVCrossEdge を逆走する", () => {
	const g = graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1), R: crossNode("R", 2) },
		{
			QP: mapVCrossEdge("QP", "Q", "P"), // ストレージ Q->P (P からは逆走)
			RQ: compEdge("RQ", "R", 2, "Q", 1), // ストレージ R->Q (Q からは逆走)
		},
	);
	// R -> Q (RQ 順走), Q -> P (QP 逆走)
	expect(lats(pathToCoordinates(g, ["RQ", "QP"], "R"))).toEqual([2, 1, 0]);
});

// ---------------------------------------------------------------------------
// 不変条件（上記すべてのケースに対して機械的に検査する）
// ---------------------------------------------------------------------------

type Case = { name: string; graph: App.SearchGraph; edgeIds: App.EdgeId[]; begin: App.NodeId };

const CASES: Case[] = [
	{ name: "単一エッジ順方向", graph: singleLine(), edgeIds: ["PQ"], begin: "P" },
	{ name: "単一エッジ逆方向", graph: singleLine(), edgeIds: ["PQ"], begin: "Q" },
	{
		name: "単一セグメント逆方向",
		graph: graph(
			{ P: crossNode("P", 0), Q: crossNode("Q", 1) },
			{ PQ: compEdge("PQ", "P", 0, "Q", 1, 0) },
		),
		edgeIds: ["PQ"],
		begin: "Q",
	},
	{
		name: "MapVCross 順方向",
		graph: graph(
			{ P: crossNode("P", 0), Q: crossNode("Q", 1) },
			{ PQ: mapVCrossEdge("PQ", "P", "Q") },
		),
		edgeIds: ["PQ"],
		begin: "P",
	},
	{
		name: "MapVCross 逆方向",
		graph: graph(
			{ P: crossNode("P", 0), Q: crossNode("Q", 1) },
			{ PQ: mapVCrossEdge("PQ", "P", "Q") },
		),
		edgeIds: ["PQ"],
		begin: "Q",
	},
	{ name: "前半順方向・後半逆方向", graph: twoEdges(), edgeIds: ["PQ", "RQ"], begin: "P" },
	{ name: "前半逆方向・後半順方向", graph: twoEdges(), edgeIds: ["RQ", "PQ"], begin: "R" },
	{
		name: "両方逆方向",
		graph: graph(
			{ P: crossNode("P", 0), Q: crossNode("Q", 1), R: crossNode("R", 2) },
			{
				QP: compEdge("QP", "Q", 1, "P", 0),
				QR: compEdge("QR", "Q", 1, "R", 2),
			},
		),
		edgeIds: ["QR", "QP"],
		begin: "R",
	},
	{ name: "MapVCross 順走 + Computed 逆走", graph: mixedEdges(), edgeIds: ["PQ", "RQ"], begin: "P" },
	{
		name: "Computed 順走 + MapVCross 逆走",
		graph: graph(
			{ P: crossNode("P", 0), Q: crossNode("Q", 1), R: crossNode("R", 2) },
			{
				QP: mapVCrossEdge("QP", "Q", "P"),
				RQ: compEdge("RQ", "R", 2, "Q", 1),
			},
		),
		edgeIds: ["RQ", "QP"],
		begin: "R",
	},
];

/** 経路上で期待される点の数 = 1（始点）+ 各エッジの寄与 */
function expectedPointCount(edgeIds: App.EdgeId[], g: App.SearchGraph): number {
	return edgeIds.reduce((sum, id) => {
		const e = g.edges[id];
		return sum + (e.type === "MapVCrossEdge" ? 1 : e.segments.length);
	}, 1);
}

for (const c of CASES) {
	test(`不変条件: 連続する重複座標を含まない (${c.name})`, () => {
		const points = pathToCoordinates(c.graph, c.edgeIds, c.begin);
		for (let i = 1; i < points.length; i++) {
			expect(points[i], `点 ${i} が点 ${i - 1} と重複している`).not.toEqual(points[i - 1]);
		}
	});

	test(`不変条件: 期待される点数がちょうど得られる (${c.name})`, () => {
		// 点を落とすと数が減り、重複すると増える。欠落・重複の両方を検出できる。
		const points = pathToCoordinates(c.graph, c.edgeIds, c.begin);
		expect(points).toHaveLength(expectedPointCount(c.edgeIds, c.graph));
	});

	test(`不変条件: 始点が経路上の最初のノード座標と一致する (${c.name})`, () => {
		const points = pathToCoordinates(c.graph, c.edgeIds, c.begin);
		expect(points[0]).toEqual(c.graph.nodes[c.begin].coordinate);
	});

	test(`不変条件: 終点が経路上の最後のノード座標と一致する (${c.name})`, () => {
		const points = pathToCoordinates(c.graph, c.edgeIds, c.begin);
		let current = c.begin;
		for (const id of c.edgeIds) {
			const e = c.graph.edges[id];
			current = current === e.end ? e.begin : e.end;
		}
		expect(points[points.length - 1]).toEqual(c.graph.nodes[current].coordinate);
	});

	test(`不変条件: 全ての点が経路上の点のうちのいずれかと地理的に一致する (${c.name})`, () => {
		const points = pathToCoordinates(c.graph, c.edgeIds, c.begin);
		const onPath = new Set<string>();
		for (const id of c.edgeIds) {
			const e = c.graph.edges[id];
			if (e.type === "MapVCrossEdge") {
				onPath.add(`${c.graph.nodes[e.begin].coordinate.lat},${c.graph.nodes[e.begin].coordinate.lng}`);
				onPath.add(`${c.graph.nodes[e.end].coordinate.lat},${c.graph.nodes[e.end].coordinate.lng}`);
			} else {
				for (const s of e.segments) {
					onPath.add(`${s.begin_coordinate.lat},${s.begin_coordinate.lng}`);
					onPath.add(`${s.end_coordinate.lat},${s.end_coordinate.lng}`);
				}
			}
		}
		for (const p of points) {
			expect(onPath.has(`${p.lat},${p.lng}`), `座標 ${p.lat} が経路上に存在しない`).toBe(true);
		}
	});
}

// ---------------------------------------------------------------------------
// エラー処理
// ---------------------------------------------------------------------------

test("始点ノードが存在しない場合はエラーになる", () => {
	expect(() => pathToCoordinates(singleLine(), ["PQ"], "ZZZ")).toThrow(/Node ZZZ not found/);
});

test("到達先ノードが存在しない場合はエラーになる", () => {
	const g = singleLine();
	const broken: App.SearchGraph = {
		nodes: { P: g.nodes["P"] },
		edges: g.edges,
	};
	expect(() => pathToCoordinates(broken, ["PQ"], "P")).toThrow(/Node Q not found/);
});

test("経路が連続していない場合はエラーになる", () => {
	const g = graph(
		{ P: crossNode("P", 0), Q: crossNode("Q", 1), R: crossNode("R", 2), S: crossNode("S", 3) },
		{
			PQ: compEdge("PQ", "P", 0, "Q", 1),
			RS: compEdge("RS", "R", 2, "S", 3),
		},
	);
	// PQ の終端は Q。RS は R と S を結ぶだけなので Q に接続していない。
	expect(() => pathToCoordinates(g, ["PQ", "RS"], "P")).toThrow(
		/does not connect to current node/,
	);
});

test("経路の終端ノードの座標が欠落しない", () => {
	// 終端ノード itself が最後の点として必ず現れることの明示的な回帰テスト
	expect(lats(pathToCoordinates(singleLine(), ["PQ"], "Q"))).toContain(0);
	expect(lats(pathToCoordinates(twoEdges(), ["RQ", "PQ"], "R"))).toContain(0);
});
// ---------------------------------------------------------------------------
// 実パイプライン統合テスト
// ---------------------------------------------------------------------------
//
// ここまでは検索グラフ（SearchGraph）を直接組み立てていたが、実際には
//   CrossConvert -> fold2DegreeEdges -> pathFind -> pathToCoordinates
// というパイプラインを通る。fold2DegreeEdges が軸に持つ
// (折り返しを反転させ segments を連結する) ため、単純な fixture では
// 再現できない並びが得られる。最終的な polyline が連続であることを
// 実際のグラフ生成コードを通して保証する。

import { CrossConvert } from "../../src/lib/cross_transform";
import { fold2DegreeEdges } from "../../src/lib/fold2degree";
import { pathFind } from "../../src/lib/path_finder";

const INTEGRATION_COORD: Record<string, App.Coordinate> = {
  // 一列に並んだ 3 点（P=0, Q=1, R=2）と、そこから伸びる 2 点
  P: { lat: 0, lng: 0 },
  Q: { lat: 0, lng: 0.001 },
  R: { lat: 0, lng: 0.002 },
  U: { lat: 0.001, lng: 0.0005 },
  D: { lat: -0.001, lng: 0.0005 },
};

function osmEdge(
  id: string,
  begin: string,
  end: string,
  direction: App.TravelDirection = "both",
): App.OSMEdge {
  return { type: "OSMEdge", id, begin, end, direction, highway: "residential", width: 3, sidewalk: "both" };
}

function buildSearchGraph(edgeList: App.OSMEdge[]): App.SearchGraph {
  const nodes: { [key: App.NodeId]: App.MapNode } = {};
  const edges: { [key: App.EdgeId]: App.OSMEdge } = {};
  for (const e of edgeList) {
    edges[e.id] = e;
    for (const nid of [e.begin, e.end]) {
      if (!nodes[nid]) {
        nodes[nid] = { type: "MapNode", id: nid, coordinate: INTEGRATION_COORD[nid], edges: [] };
      }
      nodes[nid].edges.push(e.id);
    }
  }
  const cc = CrossConvert({ nodes, edges });
  if (cc instanceof Error) throw cc;
  const sg = fold2DegreeEdges(cc);
  if (sg instanceof Error) throw sg;
  return sg;
}

const PARAMS: App.SearchParameters = {
  lambda: 1,
  mix_score_weight: 0,
  view_score_weight: 0,
  width_score_weight: 0,
};

/** 平距離の近似（m）。連続性の上限判定にのみ使う。 */
function approxMeters(a: App.Coordinate, b: App.Coordinate): number {
  return Math.hypot(a.lat - b.lat, a.lng - b.lng) * 111320;
}

/** グラフ中で 1 本のエッジが移動する最大距離 */
function maxEdgeLengthMeters(g: App.SearchGraph): number {
  let max = 0;
  for (const e of Object.values(g.edges)) {
    if (e.type === "MapVCrossEdge") {
      max = Math.max(max, approxMeters(g.nodes[e.begin].coordinate, g.nodes[e.end].coordinate));
    } else {
      for (const seg of e.segments) {
        max = Math.max(max, approxMeters(seg.begin_coordinate, seg.end_coordinate));
      }
    }
  }
  return max;
}

/**
 * 経路上の点の数 = 始点 1 個 + 各エッジの寄与。
 * 点が欠落したり重複したりするとその場で失敗する。
 */
function assertPointCount(
  points: App.Coordinate[],
  edgeIds: App.EdgeId[],
  g: App.SearchGraph,
) {
  const expected = edgeIds.reduce((sum, id) => {
    const e = g.edges[id];
    return sum + (e.type === "MapVCrossEdge" ? 1 : e.segments.length);
  }, 1);
  expect(points).toHaveLength(expected);
}

/** 隣り合う点の距離が 1 エッジ分の長さを超えないこと（点の飛ばし・逆行の検出） */
function assertContinuous(points: App.Coordinate[], g: App.SearchGraph) {
  const limit = maxEdgeLengthMeters(g) + 1; // 丸めの余裕
  for (let i = 1; i < points.length; i++) {
    expect(
      approxMeters(points[i - 1], points[i]),
      `点 ${i - 1} -> ${i} が 1 エッジ分 (${Math.round(limit)}m) を超えて飛んでいる`,
    ).toBeLessThanOrEqual(limit);
  }
}

test("統合: 一直鎖を順方向に進むと連続した polyline になる", () => {
  const g = buildSearchGraph([osmEdge("PQ", "P", "Q"), osmEdge("QR", "Q", "R")]);
  const edgeIds = pathFind(g, PARAMS, ["P"], ["R"]);
  expect(edgeIds.length).toBeGreaterThan(0);
  const points = pathToCoordinates(g, edgeIds, "P");
  assertPointCount(points, edgeIds, g);
  assertContinuous(points, g);
  expect(points[0]).toEqual(g.nodes["P"].coordinate);
  expect(points[points.length - 1]).toEqual(g.nodes["R"].coordinate);
});

test("統合: 一直鎖を逆方向に進んでも連続した polyline になる", () => {
  const g = buildSearchGraph([osmEdge("PQ", "P", "Q"), osmEdge("QR", "Q", "R")]);
  const edgeIds = pathFind(g, PARAMS, ["R"], ["P"]);
  expect(edgeIds.length).toBeGreaterThan(0);
  const points = pathToCoordinates(g, edgeIds, "R");
  assertPointCount(points, edgeIds, g);
  assertContinuous(points, g);
  expect(points[0]).toEqual(g.nodes["R"].coordinate);
  expect(points[points.length - 1]).toEqual(g.nodes["P"].coordinate);
});

test("統合: 交差点を含む経路でも連続した polyline になる", () => {
  // Q の次数が 4 になり、交差点変換と畳み込みが実際に走る
  const g = buildSearchGraph([
    osmEdge("PQ", "P", "Q"),
    osmEdge("QR", "Q", "R"),
    osmEdge("QU", "Q", "U"),
    osmEdge("QD", "Q", "D"),
  ]);
  expect(Object.values(g.edges).some((e) => e.type === "MapVCrossEdge")).toBe(true);

  const routes: [App.NodeId, App.NodeId][] = [
    ["P", "R"], ["R", "P"], ["U", "R"], ["R", "U"], ["D", "P"], ["P", "D"],
  ];
  for (const [from, to] of routes) {
    const edgeIds = pathFind(g, PARAMS, [from], [to]);
    expect(edgeIds.length, `${from} -> ${to} の経路が見つからない`).toBeGreaterThan(0);
    const points = pathToCoordinates(g, edgeIds, from);
    assertPointCount(points, edgeIds, g);
    assertContinuous(points, g);
    expect(points[0], `${from} -> ${to} の始点が一致しない`).toEqual(g.nodes[from].coordinate);
    expect(
      points[points.length - 1],
      `${from} -> ${to} の終点が一致しない`,
    ).toEqual(g.nodes[to].coordinate);
  }
});

test("統合: 交差点では入口と出口が別ノードになるため座標が重複する（仕様）", () => {
  // CrossConvert が分岐点 Q を Q_P / Q_R / Q_U / Q_D に展開する。
  // 各ノードは同一座標を持つため、入口と出口が別ノードだと
  // polyline 上でその座標が 2 回現れる（長さ 0 の線分）。
  // これは SCC 表現の帰結であり、幾何学的な破綻ではない。
  const g = buildSearchGraph([
    osmEdge("PQ", "P", "Q"),
    osmEdge("QR", "Q", "R"),
    osmEdge("QU", "Q", "U"),
    osmEdge("QD", "Q", "D"),
  ]);
  const junction = g.nodes["Q_P"].coordinate;
  const points = pathToCoordinates(g, pathFind(g, PARAMS, ["P"], ["R"]), "P");
  const atJunction = points.filter((p) => p.lat === junction.lat && p.lng === junction.lng);
  expect(atJunction).toHaveLength(2);
  // かつ長さは 0 で、他の点は影響を受けていない
  expect(points.map((p) => p.lng)).toEqual([0, 0.001, 0.001, 0.002]);
});

test("統合: 経路が見つからない場合は始点の座標だけを返す", () => {
  const g = buildSearchGraph([osmEdge("PQ", "P", "Q"), osmEdge("QR", "Q", "R")]);
  const isolated: App.SearchGraph = {
    nodes: { ...g.nodes, Z: crossNode("Z", 9) },
    edges: { ...g.edges },
  };
  const edgeIds = pathFind(isolated, PARAMS, ["P"], ["Z"]);
  expect(edgeIds).toEqual([]);
  expect(pathToCoordinates(isolated, edgeIds, "P")).toEqual([isolated.nodes["P"].coordinate]);
});
