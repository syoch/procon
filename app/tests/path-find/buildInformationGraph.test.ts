import { expect, test, vi } from "vitest";
import { buildInformationGraph, pathToCoordinates } from "../../src/routes/api/path-find/pathFind";
import { CrossConvert } from "../../src/lib/cross_transform";
import { fold2DegreeEdges } from "../../src/lib/fold2degree";
import { transientSplit } from "../../src/lib/transient-split";
import { distanceOf } from "../../src/lib/utils/haversine";

// Node 上では leaflet が window を要求するため、距離計算だけのスタブに差し替える
vi.mock("leaflet", async () => await import("../mocks/leaflet"));

// ---------------------------------------------------------------------------
// fixtures（実パイプライン: OSMGraph → CrossConvert → fold2DegreeEdges → transientSplit）
// ---------------------------------------------------------------------------

type Pt = [number, number];

/** 格子の 1 マス (度)。x が経度 (東)、y が緯度 (北)。縦横を同じにして、90° が 90° のまま測れるようにする */
const UNIT = 0.001;

function toCoord([x, y]: Pt): App.Coordinate {
	return { lat: y * UNIT, lng: x * UNIT };
}

/** 点を原点まわりに 90° × k 回転する（東向きの道路網を、北・西・南向きにも流用するため） */
function rotate([x, y]: Pt, k: number): Pt {
	let p: Pt = [x, y];
	for (let i = 0; i < k; i++) p = [-p[1], p[0]];
	return p;
}

/** 折れ線の道 (way) の並びから OSMGraph を作る。同じ座標の点は同じノードになる */
function makeOsmGraph(ways: Pt[][], wayTags?: Record<string, string>[]): App.OSMGraph {
	const nodes: Record<string, any> = {};
	const edges: Record<string, any> = {};

	const nodeId = (p: Pt) => {
		const id = `N${p[0]},${p[1]}`;
		if (!nodes[id]) nodes[id] = { type: "MapNode", id, coordinate: toCoord(p), edges: [] };
		return id;
	};

	ways.forEach((way, w) => {
		// 現在の way (w番目) に対応するタグを取得。渡されていなければ空のオブジェクト {} にする
		const currentTags = wayTags && wayTags[w] ? wayTags[w] : {};

		for (let i = 0; i + 1 < way.length; i++) {
			const b = nodeId(way[i]);
			const e = nodeId(way[i + 1]);
			const id = `W${w}_${i}`;
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
						tags: { ...currentTags }, // ← ここにタグを追加（テスト対象の関数がここを見にくるため）
					},
				],
				tags: { ...currentTags } // ← ここも空の {} から書き換え
			};
			nodes[b].edges.push(id);
			nodes[e].edges.push(id);
		}
	});
	return { nodes, edges } as unknown as App.OSMGraph;
}

/** 隣接辺を幅優先で辿り、始点から終点までの辺列を返す（道路網は木なので経路は一意） */
function shortestPathEdges(g: App.SearchGraph, begin: App.NodeId, end: App.NodeId): App.EdgeId[] {
	const prev = new Map<App.NodeId, App.EdgeId>();
	const seen = new Set<App.NodeId>([begin]);
	const queue: App.NodeId[] = [begin];
	while (queue.length) {
		const cur = queue.shift()!;
		if (cur === end) break;
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
	let n = end;
	while (n !== begin) {
		const eid = prev.get(n);
		if (!eid) throw new Error("経路が見つかりません（テストの道路網を確認してください）");
		edgeIds.push(eid);
		const edge = g.edges[eid];
		n = edge.begin === n ? edge.end : edge.begin;
	}
	return edgeIds.reverse();
}

/** 道路網と始点・終点から、案内情報 (buildInformationGraph) を作る */
function guidance(ways: Pt[][], begin: Pt, end: Pt, wayTags?: Record<string, string>[]) {
// wayTags を makeOsmGraph に渡す (makeOsmGraph 側も修正が必要)
    const cc = CrossConvert(makeOsmGraph(ways, wayTags)); 
    
    if (cc instanceof Error) throw cc;
    const g = fold2DegreeEdges(cc);
    if (g instanceof Error) throw g;

    const beginNode = transientSplit(g, toCoord(begin));
    const endNode = transientSplit(g, toCoord(end));
    const edgeIds = shortestPathEdges(g, beginNode, endNode);

    for (const id of edgeIds) {
        if (g.edges[id].type === "MapVCrossEdge") continue;
        g.edges[id] = { ...g.edges[id], type: "ComputedEdge", view_score: 1, width_score: 1, mix_score: 1 } as App.ComputedEdge;
    }

    return { g, beginNode, edgeIds, info: buildInformationGraph(g, edgeIds, beginNode) };
};

/** 案内の種別のうち、交差点での判定（直進・右折・左折・Uターン）だけを取り出す */
function turnsOf(info: App.InformationGraph) {
	return info.type.filter((t) => t === "straight" || t === "left" || t === "right" || t === "uturn");
}

/** 経路の総距離 (pathToCoordinates の折れ線の長さ) */
function totalDistanceOf(g: App.SearchGraph, edgeIds: App.EdgeId[], beginNode: App.NodeId): number {
	const coords = pathToCoordinates(g, edgeIds, beginNode);
	let sum = 0;
	for (let i = 1; i < coords.length; i++) sum += distanceOf(coords[i - 1], coords[i]);
	return sum;
}

// ---------------------------------------------------------------------------
// 1. 右折・左折が実際の曲がる向きと一致する
// ---------------------------------------------------------------------------

/**
 * 東向きに進み、x=1 の十字路で北 (左) か南 (右) へ曲がる。x=-1 にも枝があり、交差点は 2 個。
 * 辺をどちら向きに通るかは道の定義順で決まるため、4 方位に回転して向きによらず正しいことを確かめる
 */
function turnNetwork(): Pt[][] {
	return [
		[[-3, 0], [-1, 0], [1, 0], [3, 0]],
		[[-1, 0], [-1, 1]],
		[[1, -3], [1, 0], [1, 3]],
	];
}

const HEADINGS = ["東", "北", "西", "南"];

for (let k = 0; k < 4; k++) {
	for (const side of ["left", "right"] as const) {
		test(`${HEADINGS[k]}向きに進み、${side === "left" ? "左" : "右"}へ曲がると ${side} と案内される`, () => {
			const sign = side === "left" ? 1 : -1;
			const ways = turnNetwork().map((way) => way.map((p) => rotate(p, k)));
			const { info } = guidance(ways, rotate([-2.5, 0], k), rotate([1, 2.5 * sign], k));

			// 1 個目の交差点は直進、2 個目の交差点で曲がる
			expect(turnsOf(info)).toEqual(["straight", side]);
		});
	}
}

// ---------------------------------------------------------------------------
// 2. 交差点 1 個につき、判定がちょうど 1 回
// ---------------------------------------------------------------------------

for (const n of [1, 2, 3, 5]) {
	test(`交差点を ${n} 個直進すると、直進の判定が ${n} 個になる`, () => {
		const main: Pt[] = Array.from({ length: n + 2 }, (_, i) => [i, 0]);
		const stubs: Pt[][] = Array.from({ length: n }, (_, i) => [[i + 1, 0], [i + 1, 1]]);
		const { info } = guidance([main, ...stubs], [0.5, 0], [n + 0.5, 0]);

		expect(turnsOf(info)).toEqual(Array(n).fill("straight"));
	});
}

// ---------------------------------------------------------------------------
// 3. 左右に交互に曲がる経路で、すべての曲がり角が案内に出る（交差点の取りこぼしがない）
// ---------------------------------------------------------------------------

/** 東→北→東→北…と階段状に進む道。角はすべて枝のある交差点 */
function staircase(step: number): { ways: Pt[][]; end: Pt } {
	const corners: Pt[] = [];
	const line: Pt[] = [[0, 0]];
	let x = 0;
	let y = 0;
	for (let i = 0; i < 5; i++) {
		if (i % 2 === 0) x += step; else y += step;
		line.push([x, y]);
		corners.push([x, y]);
	}
	// 最後の角から先へ少しだけ伸ばし、そこを終点側にする
	line.push([x, y + step]);
	const stubs: Pt[][] = corners.map(([cx, cy]) => [[cx, cy], [cx - step / 2, cy + step / 2]]);
	return { ways: [line, ...stubs], end: [x, y + step * 0.7] };
}

for (const [name, step] of [["交差点が 1 ブロックおき", 1], ["交差点が密（0.2 ブロック）", 0.2]] as const) {
	test(`階段状の道 (${name}) で、左・右・左・右・左がすべて案内に出る`, () => {
		const { ways, end } = staircase(step);
		const { info } = guidance(ways, [step * 0.5, 0], end);

		expect(turnsOf(info)).toEqual(["left", "right", "left", "right", "left"]);
	});
}

// ---------------------------------------------------------------------------
// 4. 急な曲がり（Uターン）
// ---------------------------------------------------------------------------

test("鋭角に引き返す枝へ入ると uturn と案内される", () => {
	const ways: Pt[][] = [
		[[-3, 0], [0, 0], [2, 0]],
		[[0, 0], [-2, 0.3]], // 東向きに来て、約 172° 引き返す
	];
	const { info } = guidance(ways, [-2.5, 0], [-1, 0.15]);

	expect(turnsOf(info)).toEqual(["uturn"]);
});

test("135° の急な曲がりは uturn ではなく右折になる", () => {
	const ways: Pt[][] = [
		[[-3, 0], [0, 0], [2, 0]],
		[[0, 0], [-1, -1]], // 東向きに来て、南西へ（右に 135°）
	];
	const { info } = guidance(ways, [-2.5, 0], [-0.5, -0.5]);

	expect(turnsOf(info)).toEqual(["right"]);
});

// ---------------------------------------------------------------------------
// 5. 距離
// ---------------------------------------------------------------------------

/** 道の途中に屈曲があり、交差点で右折する道路網 */
function bentNetwork(): Pt[][] {
	return [
		[[0, 0], [1, 0], [1.5, 0.3], [2, 0], [3, 0], [4, 0]],
		[[1, 0], [1, 1]],
		[[2, 1], [2, 0], [2, -1], [2, -1.5], [2.3, -2], [2, -2.5], [2, -3]],
		[[2, -3], [3, -3]],
	];
}

test("案内の距離の合計が、経路の総距離と一致する（屈曲した道・右左折あり）", () => {
	const { g, beginNode, edgeIds, info } = guidance(bentNetwork(), [0.5, 0], [2, -2.8]);

	const sum = info.distance.reduce((a, b) => a + b, 0);
	expect(sum).toBeCloseTo(totalDistanceOf(g, edgeIds, beginNode), 1);
});

test("案内の距離の合計が、経路の総距離と一致する（交差点が連続する階段状の道）", () => {
	const { ways, end } = staircase(0.2);
	const { g, beginNode, edgeIds, info } = guidance(ways, [0.1, 0], end);

	const sum = info.distance.reduce((a, b) => a + b, 0);
	expect(sum).toBeCloseTo(totalDistanceOf(g, edgeIds, beginNode), 1);
});

test("交差点の判定の位置には距離を載せない（距離は 0）", () => {
	const { info } = guidance(bentNetwork(), [0.5, 0], [2, -2.8]);

	info.type.forEach((t, i) => {
		if (t === "straight" || t === "left" || t === "right" || t === "uturn") {
			expect(info.distance[i]).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// 6. 形式
// ---------------------------------------------------------------------------

test("先頭は start、末尾は finish で、type と distance の長さが揃い、定義された種別だけを使う", () => {
	const { info } = guidance(bentNetwork(), [0.5, 0], [2, -2.8]);

	expect(info.type[0]).toBe("start");
	expect(info.type[info.type.length - 1]).toBe("finish");
	expect(info.distance).toHaveLength(info.type.length);

	const allowed = new Set(["start", "finish", "segments", "straight", "left", "right", "uturn"]);
	for (const t of info.type) expect(allowed.has(t)).toBe(true);
	for (const d of info.distance) expect(d).toBeGreaterThanOrEqual(0);
});

// ---------------------------------------------------------------------------
// 7. 道が折れ線のとき（両端のノードを結ぶ直線 (弦) と、交差点での実際の向きがずれる）
// ---------------------------------------------------------------------------

/**
 * 交差点に入る道が、交差点の手前で直角に曲がっている。
 * 東向きに n ブロック進み、(n,0) で北へ曲がって、1 ブロック先の交差点 (n,1) に着く。
 * 交差点に入る辺は 1 本の折れ線で、実際に入る向きは北だが、両端を結ぶ直線は北東（n が大きいほど東寄り）を向く。
 * 交差点では北へ直進する場合と、東へ曲がる (右折) 場合を確かめる
 */
for (const n of [4, 9, 19, 39]) {
	test(`交差点の手前で直角に曲がる道（${n} ブロック先から）でも、交差点を直進すると straight になる`, () => {
		const ways: Pt[][] = [
			[[0, 0], [n, 0], [n, 1], [n, 3]],
			[[n, 1], [n + 1, 1]],
		];
		const { info } = guidance(ways, [n / 2, 0], [n, 2.5]);

		expect(turnsOf(info)).toEqual(["straight"]);
	});

	test(`交差点の手前で直角に曲がる道（${n} ブロック先から）でも、交差点で東へ曲がると right になる`, () => {
		const ways: Pt[][] = [
			[[0, 0], [n, 0], [n, 1], [n, 3]],
			[[n, 1], [n + 3, 1]],
		];
		const { info } = guidance(ways, [n / 2, 0], [n + 1.5, 1]);

		expect(turnsOf(info)).toEqual(["right"]);
	});
}

test("交差点を出てすぐ道が曲がっていても、交差点を直進すれば straight になる", () => {
	// 出る辺は、交差点 (0,0) から東へ 1 ブロック進んでから北へ曲がる。両端を結ぶ直線は北東を向く
	const ways: Pt[][] = [
		[[-3, 0], [0, 0], [1, 0], [1, 3]],
		[[0, 0], [0, 1]],
	];
	const { info } = guidance(ways, [-2.5, 0], [1, 2.5]);

	expect(turnsOf(info)).toEqual(["straight"]);
});

test("出る道が引き返す向き (約 179°) で始まるなら、先で別の方角へ曲がっていても uturn になる", () => {
	// 交差点 (0,0) から西へほぼ引き返し (179.0°)、すぐ北へ曲がる。両端を結ぶ直線は北西を向く
	const ways: Pt[][] = [
		[[-3, 0], [0, 0], [3, 0]],
		[[0, 0], [-1, 0.017], [-1, 3]],
	];
	const { info } = guidance(ways, [-2.5, 0], [-1, 2.5]);

	expect(turnsOf(info)).toEqual(["uturn"]);
});

test("実パイプラインを通して、直進時に交差道路名(crossingRoadNames)が取得できること", () => {
    // 1. [0, 0] で交差するシンプルな十字路の座標データ
    const ways: Pt[][] = [
        [[0, -1], [0, 0], [0, 1]], // [0] 南北の道（本通り）
        [[-1, 0], [0, 0], [1, 0]]  // [1] 東西の道（クロス通り）
    ];

    // 2. 4つ目の引数として渡す wayTags（道路名）
    const wayTags = [
        { name: '本通り' },     // ways[0] の道に付与
        { name: 'クロス通り' }   // ways[1] の道に付与
    ];

    // 3. 南 [0, -0.5] から 北 [0, 0.5] へ直進するルートで guidance を実行
    const { info } = guidance(ways, [0, -0.5], [0, 0.5], wayTags);

<<<<<<< HEAD
    // 4. 検証: info の中に「クロス通り」という文字が抽出されているか確認
    const stringifiedInfo = JSON.stringify(info);
    expect(stringifiedInfo).toContain('クロス通り');
=======
    // 4. 検証: 交差道路名が正しい添字 (交差点の位置) に入っていること
    //    部分一致では、誤った添字に入っても通ってしまうため添字まで見る
    const named = info.crossingRoadNames
        .map((name, index) => ({ name, index }))
        .filter((entry) => entry.name !== null && entry.name !== "");
    expect(named.length).toBe(1);
    expect(named[0].name).toBe('クロス通り');
    // 交差点 (turn) の位置に入る。segments の位置ではない
    expect(info.type[named[0].index]).not.toBe("segments");
>>>>>>> 1bc1565dd005c119a8746fcb46734f5077eb9330
});