import { expect, test, vi } from "vitest";
import { countPassedIntersections, pathToNodeIds } from "../../src/routes/api/path-find/pathFind";
import { CrossConvert } from "../../src/lib/cross_transform";
import { fold2DegreeEdges } from "../../src/lib/fold2degree";
import { transientSplit } from "../../src/lib/transient-split";

// Node 上では leaflet が window を要求するため、距離計算だけのスタブに差し替える
vi.mock("leaflet", async () => await import("../mocks/leaflet"));

// ---------------------------------------------------------------------------
// fixtures（手Resolvableグラフ）
// ---------------------------------------------------------------------------

function crossNode(id: App.NodeId, lat: number, group?: App.NodeId[]): App.MapVCrossNode {
	return {
		type: "MapVCrossNode",
		id,
		coordinate: { lat, lng: 0 },
		edges: [],
		group_nodes: group ?? [id],
	};
}

function splittedNode(id: App.NodeId, lat: number): App.SplittedNode {
	return { type: "SplittedNode", id, coordinate: { lat, lng: 0 }, edges: [] };
}

function computedEdge(
	id: App.EdgeId,
	begin: App.NodeId,
	beginLat: number,
	end: App.NodeId,
	endLat: number,
): App.ComputedEdge {
	return {
		type: "ComputedEdge",
		id,
		begin,
		end,
		direction: "both",
		segments: [
			{
				begin_coordinate: { lat: beginLat, lng: 0 },
				end_coordinate: { lat: endLat, lng: 0 },
				highway: "residential",
				width: 3,
				sidewalk: "both",
			},
		],
		view_score: 1,
		width_score: 1,
		mix_score: 1,
	};
}

function crossEdge(
	id: App.EdgeId,
	begin: App.NodeId,
	end: App.NodeId,
): App.MapVCrossEdge {
	return { type: "MapVCrossEdge", id, begin, end, view_score: 1, direction: "both" };
}

function graph(nodes: App.SearchGraph["nodes"], edges: App.SearchGraph["edges"]): App.SearchGraph {
	return { nodes, edges } as App.SearchGraph;
}

/** 一直線の道路 S - C - E（3 ノード 2 エッジ） */
function straightLine(): App.SearchGraph {
	return graph(
		{
			S: splittedNode("S", 0),
			C: crossNode("C", 1),
			E: crossNode("E", 2),
		},
		{
			SC: computedEdge("SC", "S", 0, "C", 1),
			CE: computedEdge("CE", "C", 1, "E", 2),
		},
	);
}

/** 交差点 T を 2 つの MapVCrossNode で表現したグラフ（ clique 通過の最小形） */
function oneIntersection(): App.SearchGraph {
	return graph(
		{
			S: splittedNode("S", 0),
			T_1: crossNode("T_1", 1, ["T_1", "T_2"]),
			T_2: crossNode("T_2", 1, ["T_1", "T_2"]),
			E: splittedNode("E", 2),
		},
		{
			"inT": computedEdge("inT", "S", 0, "T_1", 1),
			"Tx": crossEdge("Tx", "T_1", "T_2"),
			"outT": computedEdge("outT", "T_2", 1, "E", 2),
		},
	);
}

// ---------------------------------------------------------------------------
// 1. pathToNodeIds — 辺列からノード列を復元する
// ---------------------------------------------------------------------------

test("空の辺列なら始点だけになる", () => {
	expect(pathToNodeIds(straightLine(), [], "S")).toEqual(["S"]);
});

test("順方向の辺列を走行順に並べる", () => {
	expect(pathToNodeIds(straightLine(), ["SC", "CE"], "S")).toEqual(["S", "C", "E"]);
});

test("逆方向の辺列でも走行順にノードを辿る", () => {
	// E から西へ進む場合、辺は CE → SC の順になる。
	// current が edge.end のとき edge.begin へ進まなければならない。
	expect(pathToNodeIds(straightLine(), ["CE", "SC"], "E")).toEqual(["E", "C", "S"]);
});

test("ComputedEdge と MapVCrossEdge が混ざっても列挙できる", () => {
	const nodes = pathToNodeIds(oneIntersection(), ["inT", "Tx", "outT"], "S");
	expect(nodes).toEqual(["S", "T_1", "T_2", "E"]);
});

test("ノード列の長さは辺数 + 1", () => {
	const g = straightLine();
	for (const edgeIds of [[], ["SC"], ["SC", "CE"]]) {
		expect(pathToNodeIds(g, edgeIds, "S").length).toBe(edgeIds.length + 1);
	}
});

// ---------------------------------------------------------------------------
// 2. countPassedIntersections — MapVCrossNode 数 / 2
// ---------------------------------------------------------------------------

test("1 つの MapVCrossNode だけでは交差点として数えない", () => {
	// 交差点の clique を通ると 2 ノードなので、1 ノードしか現れないときは 0 になる
	const g = graph(
		{ S: splittedNode("S", 0), C: crossNode("C", 1), E: splittedNode("E", 2) },
		{ SC: computedEdge("SC", "S", 0, "C", 1), CE: computedEdge("CE", "C", 1, "E", 2) },
	);
	const nodes = pathToNodeIds(g, ["SC", "CE"], "S");
	expect(nodes.filter((id) => g.nodes[id].type === "MapVCrossNode")).toHaveLength(1);
	expect(countPassedIntersections(g, nodes)).toBe(0);
});

test("交差点 0 個（SplittedNode のみ）", () => {
	const g = graph(
		{ S: splittedNode("S", 0), E: splittedNode("E", 1) },
		{ SE: computedEdge("SE", "S", 0, "E", 1) },
	);
	const nodes = pathToNodeIds(g, ["SE"], "S");
	expect(countPassedIntersections(g, nodes)).toBe(0);
});

test("交差点 1 個（clique を 2 ノードで通過）", () => {
	const g = oneIntersection();
	const nodes = pathToNodeIds(g, ["inT", "Tx", "outT"], "S");
	expect(nodes.filter((id) => g.nodes[id].type === "MapVCrossNode")).toHaveLength(2);
	expect(countPassedIntersections(g, nodes)).toBe(1);
});

test("交差点 3 個（6 ノード）", () => {
	// T1, T2, T3 の 3 交差点を通過
	const nodes: App.NodeId[] = ["S"];
	const edges: Record<string, any> = {};
	const g = { nodes: {} as any, edges } as App.SearchGraph;
	const add = (n: App.NodeId, lat: number) => {
		g.nodes[n] = crossNode(n, lat, [n]);
	};
	g.nodes["S"] = splittedNode("S", 0);
	add("T1_a", 1); add("T1_b", 1);
	add("T2_a", 2); add("T2_b", 2);
	add("T3_a", 3); add("T3_b", 3);
	g.nodes["E"] = splittedNode("E", 4);
	edges["S-T1"] = computedEdge("S-T1", "S", 0, "T1_a", 1);
	edges["T1x"] = crossEdge("T1x", "T1_a", "T1_b");
	edges["T1-T2"] = computedEdge("T1-T2", "T1_b", 1, "T2_a", 2);
	edges["T2x"] = crossEdge("T2x", "T2_a", "T2_b");
	edges["T2-T3"] = computedEdge("T2-T3", "T2_b", 2, "T3_a", 3);
	edges["T3x"] = crossEdge("T3x", "T3_a", "T3_b");
	edges["T3-E"] = computedEdge("T3-E", "T3_b", 3, "E", 4);
	const path: App.EdgeId[] = ["S-T1", "T1x", "T1-T2", "T2x", "T2-T3", "T3x", "T3-E"];
	for (const e of path) nodes.push((g.edges[e] as any).begin === nodes[nodes.length - 1] ? (g.edges[e] as any).end : (g.edges[e] as any).begin);

	expect(countPassedIntersections(g, nodes)).toBe(3);
});

test("同じ交差点を再通過すると通過回数として数える", () => {
	// T の clique を 2 回通る（4 ノード）→ 2 個
	const g = graph(
		{
			S: splittedNode("S", 0),
			T_1: crossNode("T_1", 1, ["T_1", "T_2"]),
			T_2: crossNode("T_2", 1, ["T_1", "T_2"]),
			M: splittedNode("M", 2),
			T_3: crossNode("T_3", 3, ["T_1", "T_2"]),
			T_4: crossNode("T_4", 3, ["T_1", "T_2"]),
			E: splittedNode("E", 4),
		},
		{
			"inT": computedEdge("inT", "S", 0, "T_1", 1),
			"Tx1": crossEdge("Tx1", "T_1", "T_2"),
			"outT": computedEdge("outT", "T_2", 1, "M", 2),
			"inT2": computedEdge("inT2", "M", 2, "T_3", 3),
			"Tx2": crossEdge("Tx2", "T_3", "T_4"),
			"outT2": computedEdge("outT2", "T_4", 3, "E", 4),
		},
	);
	const nodes = pathToNodeIds(g, ["inT", "Tx1", "outT", "inT2", "Tx2", "outT2"], "S");
	expect(nodes.filter((id) => g.nodes[id].type === "MapVCrossNode")).toHaveLength(4);
	// group_nodes で数える実装なら 1 になる。/2 方式は通過回数なので 2。
	expect(countPassedIntersections(g, nodes)).toBe(2);
});

test("未知のノード ID が混ざっても落ちない", () => {
	const g = oneIntersection();
	const nodes = ["S", "存在しないノード", "T_1", "T_2", "E"];
	expect(() => countPassedIntersections(g, nodes as App.NodeId[])).not.toThrow();
	// 未知ノードは数えないので、既知の 2 ノードだけが反映される
	expect(countPassedIntersections(g, nodes as App.NodeId[])).toBe(1);
});

test("空のノード列は 0", () => {
	expect(countPassedIntersections(oneIntersection(), [])).toBe(0);
});

// ---------------------------------------------------------------------------
// 3. 実パイプラインとの整合（CrossConvert → fold2DegreeEdges → transientSplit）
// ---------------------------------------------------------------------------

/** A - T0 - T1 - ... - T(n-1) - B の一直線に、各 T から枝を branches 本伸ばす */
function makeOsmGraph(intersections: number, branches: number): App.OSMGraph {
	const nodes: Record<string, any> = {};
	const edges: Record<string, any> = {};
	const STEP = 0.001;

	const addNode = (id: string, lng: number) => {
		nodes[id] = { type: "MapNode", id, coordinate: { lat: 0, lng }, edges: [] };
	};
	const addEdge = (id: string, b: string, e: string) => {
		edges[id] = {
			type: "OSMEdge",
			id,
			begin: b,
			end: e,
			highway: "residential",
			width: 3,
			sidewalk: "both",
			segments: [
				{
					begin_coordinate: nodes[b].coordinate,
					end_coordinate: nodes[e].coordinate,
					highway: "residential",
					width: 3,
					sidewalk: "both",
				},
			],
		};
		nodes[b].edges.push(id);
		nodes[e].edges.push(id);
	};

	addNode("A", 0);
	addNode("B", (intersections + 1) * STEP);
	for (let i = 0; i < intersections; i++) addNode(`T${i}`, (i + 1) * STEP);
	addEdge("A-T0", "A", "T0");
	for (let i = 0; i + 1 < intersections; i++) addEdge(`T${i}-T${i + 1}`, `T${i}`, `T${i + 1}`);
	if (intersections > 0) addEdge(`T${intersections - 1}-B`, `T${intersections - 1}`, "B");
	for (let i = 0; i < intersections; i++) {
		for (let j = 0; j < branches; j++) {
			const id = `D${i}_${j}`;
			addNode(id, (i + 1) * STEP + (j + 1) * 0.0001);
			addEdge(`${id}-T${i}`, id, `T${i}`);
		}
	}
	return { nodes, edges } as unknown as App.OSMGraph;
}

/** 実パイプラインを通し、端点を transientSplit で固定してノード列を返す */
function pipelineNodeIds(intersections: number, branches: number): {
	g: App.SearchGraph;
	nodes: App.NodeId[];
	edgeIds: App.EdgeId[];
} {
	const cc = CrossConvert(makeOsmGraph(intersections, branches));
	if (cc instanceof Error) throw cc;
	const g = fold2DegreeEdges(cc);
	if (g instanceof Error) throw g;
	const STEP = 0.001;
	const beginNode = transientSplit(g, { lat: 0, lng: STEP * 0.5 });
	const endNode = transientSplit(g, { lat: 0, lng: STEP * (intersections + 0.5) });

	// 隣接辺を単純 DFS で辿る（MapVCrossEdge は両方向通行可）
	const prev = new Map<App.NodeId, App.EdgeId>();
	const seen = new Set<App.NodeId>([beginNode]);
	const queue: App.NodeId[] = [beginNode];
	while (queue.length) {
		const cur = queue.shift()!;
		if (cur === endNode) break;
		for (const eid of g.nodes[cur].edges) {
			const e = g.edges[eid];
			if (!e) continue;
			const next = e.begin === cur ? e.end : e.begin;
			if (seen.has(next)) continue;
			seen.add(next);
			prev.set(next, eid);
			queue.push(next);
		}
	}
	const edgeIds: App.EdgeId[] = [];
	let n = endNode;
	while (n !== beginNode) {
		const e = prev.get(n);
		if (!e) break;
		edgeIds.push(e);
		const edge = g.edges[e];
		n = edge.begin === n ? edge.end : edge.begin;
	}
	edgeIds.reverse();
	return { g, nodes: pathToNodeIds(g, edgeIds, beginNode), edgeIds };
}

for (const branches of [1, 2, 3]) {
	test(`実パイプライン: 交差点 ${branches + 2} 枝を 1 個通過する`, () => {
		const { g, nodes } = pipelineNodeIds(1, branches);
		expect(countPassedIntersections(g, nodes)).toBe(1);
	});
}

test("実パイプライン: 交差点 5 個を連続して通過する", () => {
	const { g, nodes, edgeIds } = pipelineNodeIds(5, 1);
	const crossNodes = nodes.filter((id) => g.nodes[id].type === "MapVCrossNode");
	// 交差点 5 個 = MapVCrossNode 10 個（1 交差点あたり必ず 2 個）
	expect(crossNodes).toHaveLength(10);
	expect(countPassedIntersections(g, nodes)).toBe(5);
	expect(edgeIds.length).toBeGreaterThan(0);
});

test("実パイプライン: 交差点 0 個（分岐のない一本道）", () => {
	// 交差点の枝を 0 本にすると T も次数 2 になり、畳み込みられて消える
	const { g, nodes } = pipelineNodeIds(2, 0);
	expect(countPassedIntersections(g, nodes)).toBe(0);
});

test("実パイプライン: MapVCrossNode 数は必ず偶数（/2 の前提条件）", () => {
	// /2 による切り捨てが誤差を隠していないことを、交差点数と枝数の組み合わせで確認する
	for (let n = 1; n <= 8; n++) {
		for (const branches of [1, 2, 3, 4]) {
			const { g, nodes } = pipelineNodeIds(n, branches);
			const crossCount = nodes.filter((id) => g.nodes[id].type === "MapVCrossNode").length;
			expect(crossCount % 2, `交差点 ${n} 個・枝 ${branches} 本で MapVCrossNode ${crossCount} 個`).toBe(0);
			expect(countPassedIntersections(g, nodes), `交差点 ${n} 個・枝 ${branches} 本`).toBe(n);
		}
	}
});

test("実パイプライン: 端点ノードは交差点として数えない", () => {
	const { g, nodes } = pipelineNodeIds(3, 1);
	expect(g.nodes[nodes[0]].type).toBe("SplittedNode");
	expect(g.nodes[nodes[nodes.length - 1]].type).toBe("SplittedNode");
});
