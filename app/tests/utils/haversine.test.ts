import { expect, test } from "vitest";
import { distanceOf } from "../../src/lib/utils/haversine";

/**
 * distanceOf（haversine 公式による球面距離）のテスト。
 *
 * 検証は 3 層で行う。
 *
 * 1. 解析解で厳密に決まる値（子午線弧・半球距離など）との一致
 * 2. haversine とは数学的に別経路の公式（球面余弦定理 / equirectangular 近似）との一致
 * 3. 距離関数が満たすべき不変条件（対称性・三角不等式など）
 *
 * 参照実装には haversine を一切使わない。実装と同じ式を並べると
 * 両方が同時に壊れてもテストが通ってしまうため。
 */

// 実装が使う地球の赤道半径。期待値もこれに揃える。
const R = 6378137;
const RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// 参照実装（haversine 以外の公式）
// ---------------------------------------------------------------------------

/** 球面余弦定理。haversine とは別の経路で同じ球面距離を計算する。 */
function distanceByLawOfCosines(begin: App.Coordinate, end: App.Coordinate): number {
	const p1 = begin.lat * RAD;
	const p2 = end.lat * RAD;
	const dl = (begin.lng - end.lng) * RAD;
	const cosCentralAngle =
		Math.sin(p1) * Math.sin(p2) + Math.cos(p1) * Math.cos(p2) * Math.cos(dl);
	return R * Math.acos(Math.max(-1, Math.min(1, cosCentralAngle)));
}

/** equirectangular 近似。距離が短い区域では haversine と一致する。 */
function distanceByEquirectangular(begin: App.Coordinate, end: App.Coordinate): number {
	const p1 = begin.lat * RAD;
	const p2 = end.lat * RAD;
	const dp = p2 - p1;
	const dl = (end.lng - begin.lng) * RAD;
	return R * Math.sqrt(dp * dp + (Math.cos((p1 + p2) / 2) * dl) ** 2);
}

function coord(lat: number, lng: number): App.Coordinate {
	return { lat, lng };
}

/** m 単位の値は桁数が大きいため、絶対誤差ではなく相対誤差で比較する。 */
function expectRelative(actual: number, expected: number, relTol: number): void {
	if (expected === 0) {
		expect(actual).toBe(0);
		return;
	}
	const rel = Math.abs(actual - expected) / Math.abs(expected);
	expect(rel, `実測 ${actual} / 期待 ${expected}（相対誤差 ${rel}）`).toBeLessThanOrEqual(relTol);
}

// ---------------------------------------------------------------------------
// 1. 解析解で厳密に決まる値
// ---------------------------------------------------------------------------

test("同じ地点の距離は 0", () => {
	expect(distanceOf(coord(37.4334315, 138.8889591), coord(37.4334315, 138.8889591))).toBe(0);
	expect(distanceOf(coord(0, 0), coord(0, 0))).toBe(0);
});

test("赤道上の緯度 1 度は子午線弧 R·π/180", () => {
	expect(distanceOf(coord(0, 0), coord(1, 0))).toBeCloseTo(R * RAD, 6);
});

test("赤道上の経度 1 度も R·π/180", () => {
	// 赤道では子午線弧と赤道弧が同じ長さになる
	expect(distanceOf(coord(0, 0), coord(0, 1))).toBeCloseTo(R * RAD, 6);
});

test("子午線弧の長さは緯度に依存しない", () => {
	// 球の子午線弧は厳密に R·Δφ なので、同じ子午線上なら緯度に関係なく 1 度あたり一定。
	// 緯度をラジアンとして扱うような実装ミスを検出できる。
	for (const lat of [0, 15, 30, 45, 60, 75, 89, -30, -60, -80]) {
		expectRelative(
			distanceOf(coord(lat, 139), coord(lat + 1, 139)),
			R * RAD,
			1e-12,
		);
	}
});

test("半球の距離は π·R", () => {
	expect(distanceOf(coord(0, 0), coord(0, 180))).toBeCloseTo(R * Math.PI, 6);
	expect(distanceOf(coord(0, 0), coord(0, -180))).toBeCloseTo(R * Math.PI, 6);
});

test("極点間の距離は π·R", () => {
	expect(distanceOf(coord(90, 0), coord(-90, 0))).toBeCloseTo(R * Math.PI, 6);
});

test("赤道から極点までは π·R/2", () => {
	expect(distanceOf(coord(0, 0), coord(90, 0))).toBeCloseTo((R * Math.PI) / 2, 6);
	expect(distanceOf(coord(0, 0), coord(-90, 0))).toBeCloseTo((R * Math.PI) / 2, 6);
});

test("日付変更線をまたぐ短い距離が折り返らない", () => {
	// Δlng を [-180, 180] に丸める実装だと、0.2 度が約 359.8 度扱いになり
	// 22 km が 40000 km になる。haversine は sin の周期性により自然に折り返す。
	expect(distanceOf(coord(0, 179.9), coord(0, -179.9))).toBeCloseTo(22263.898159, 6);
});

// ---------------------------------------------------------------------------
// 2. 実座標による回帰アンカー
// ---------------------------------------------------------------------------

test("松江の2点（デバッグで使っている実座標）", () => {
	expect(distanceOf(coord(37.4334315, 138.8889591), coord(37.4478637, 138.8539283))).toBeCloseTo(
		3488.228162,
		6,
	);
});

test("東京-京都", () => {
	expect(distanceOf(coord(35.6895, 139.6917), coord(35.0116, 135.7681))).toBeCloseTo(
		364121.307522,
		6,
	);
});

test("南半球（シドニー-メルボルン）", () => {
	expect(distanceOf(coord(-33.8688, 151.2093), coord(-37.8136, 144.9631))).toBeCloseTo(
		714226.685230,
		6,
	);
});

test("高緯度で的东西方向は縮む", () => {
	// 1 度の長さは緯度が高いほど短くなる
	const at60 = distanceOf(coord(60, 0), coord(60, 1));
	const at80 = distanceOf(coord(80, 0), coord(80, 1));
	expect(at60).toBeGreaterThan(at80);
	expectRelative(at60, 55659.215553, 1e-9);
	expectRelative(at80, 19330.188765, 1e-9);
});

// ---------------------------------------------------------------------------
// 3. 不変条件
// ---------------------------------------------------------------------------

test("対称性: d(a, b) === d(b, a)", () => {
	// cos を片方の緯度だけで計算する実装（cos(begin.lat) を 2 回使う誤り）は
	// 対称性を崩す。修正前の東京-京都では 2925 m の差が出る。
	const pairs: [App.Coordinate, App.Coordinate][] = [
		[coord(35.6895, 139.6917), coord(35.0116, 135.7681)],
		[coord(37.4334315, 138.8889591), coord(37.4478637, 138.8539283)],
		[coord(-33.8688, 151.2093), coord(-37.8136, 144.9631)],
		[coord(70, 10), coord(20, -100)],
		[coord(89.9, 0), coord(-89.9, 179.9)],
	];
	for (const [a, b] of pairs) {
		// 符号反転と二乗が厳密対称なので、演算順序が同じなら完全一致になる。
		expect(distanceOf(a, b)).toBe(distanceOf(b, a));
	}
});

test("三角不等式を満たす", () => {
	const tokyo = coord(35.6895, 139.6917);
	const kyoto = coord(35.0116, 135.7681);
	const osaka = coord(34.6937, 135.5023);
	const direct = distanceOf(tokyo, osaka);
	const viaKyoto = distanceOf(tokyo, kyoto) + distanceOf(kyoto, osaka);
	expect(direct).toBeLessThanOrEqual(viaKyoto + Math.abs(direct) * 1e-12);
});

test("子午線上の中間点を挟んでも距離は保存される", () => {
	const begin = coord(30, 135);
	const mid = coord(35, 135);
	const end = coord(40, 135);
	expectRelative(
		distanceOf(begin, mid) + distanceOf(mid, end),
		distanceOf(begin, end),
		1e-12,
	);
});

test("大圏距離は平行円弧より短い", () => {
	// 同じ緯度・同じ経度差のとき、2 点を最短の great circle で結ぶと
	// 緯度方向に膨らむため、緯度の円に沿った弧（平行円弧）より短くなる。
	for (const lat of [30, 45, 60, 75]) {
		const greatCircle = distanceOf(coord(lat, 0), coord(lat, 1));
		const parallelArc = R * Math.cos(lat * RAD) * RAD;
		expect(greatCircle, `緯度 ${lat}`).toBeLessThan(parallelArc);
		// 緯度が高いほど膨張は小さくなるので、ここでは 0.01% 以内の誤差に収まる
		expectRelative(greatCircle, parallelArc, 1e-4);
	}
});

// ---------------------------------------------------------------------------
// 4. 別の公式との一致
// ---------------------------------------------------------------------------

test("1 km 以上では球面余弦定理と一致する", () => {
	// 球面余弦定理は近距離で桁落ちするため、中距離以上でのみ使う。
	const pairs: [App.Coordinate, App.Coordinate][] = [
		[coord(37.4334315, 138.8889591), coord(37.4478637, 138.8539283)],
		[coord(35.6895, 139.6917), coord(35.0116, 135.7681)],
		[coord(-33.8688, 151.2093), coord(-37.8136, 144.9631)],
		[coord(0, 0), coord(0, 180)],
		[coord(90, 0), coord(-90, 0)],
		[coord(0, 179.9), coord(0, -179.9)],
	];
	for (const [a, b] of pairs) {
		expectRelative(distanceOf(a, b), distanceByLawOfCosines(a, b), 1e-9);
	}
});

test("5 km 以下では equirectangular 近似と一致する", () => {
	// equirectangular は Δlng が大きいと破れるため、短い距離でのみ使う。
	const pairs: [App.Coordinate, App.Coordinate][] = [
		[coord(37.4334315, 138.8889591), coord(37.4478637, 138.8539283)],
		[coord(35.6895, 139.6917), coord(35.6, 139.5)],
		[coord(0, 0), coord(0, 0.02)],
		[coord(37.0, 138.0), coord(37.0 + 1 / (R * RAD), 138.0)],
		[coord(64.0, -21.0), coord(64.01, -21.02)],
	];
	for (const [a, b] of pairs) {
		expectRelative(distanceOf(a, b), distanceByEquirectangular(a, b), 1e-6);
	}
});

// ---------------------------------------------------------------------------
// 5. 堅牢性
// ---------------------------------------------------------------------------

test("常に有限な正の値を返す", () => {
	// 度をラジアンとして扱った実装は、asin の引数が 1 を超えて NaN を返す。
	// その NaN がコスト計算に混入すると Dijkstra が終了しなくなる。
	let checked = 0;
	for (let lat = -90; lat <= 90; lat += 15) {
		for (let lng = -180; lng <= 180; lng += 30) {
			for (const other of [coord(0, 0), coord(-90, -180), coord(90, 180), coord(lat, lng + 179)]) {
				const d = distanceOf(coord(lat, lng), other);
				expect(Number.isFinite(d), `(${lat}, ${lng}) -> ${JSON.stringify(other)} = ${d}`).toBe(true);
				expect(d).toBeGreaterThanOrEqual(0);
				checked++;
			}
		}
	}
	// 13 緯度 × 13 経度 × 4 パターン = 676 組を検証していることを明示する
	expect(checked).toBe(13 * 13 * 4);
});

test("旧実装で NaN になっていた座標でも有限値を返す", () => {
	// (0, 0) -> (-90, -180) は、度をラジアン扱いした式では asin の引数が 1 を超え NaN になる。
	const d = distanceOf(coord(0, 0), coord(-90, -180));
	expect(Number.isFinite(d)).toBe(true);
	expect(d).toBeCloseTo((R * Math.PI) / 2, 6);
});

test("極端な座標でも例外を投げない", () => {
	expect(() => distanceOf(coord(90, 180), coord(-90, -180))).not.toThrow();
	expect(distanceOf(coord(90, 180), coord(-90, -180))).toBeCloseTo(R * Math.PI, 6);
});
