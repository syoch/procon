import { describe, expect, test, vi } from "vitest";

import type { Boundary } from "../../src/lib/osm/boundary";
import {
    intersect,
    parseCoverage,
    routeBoundaries,
    subtract,
} from "../../src/lib/osm/endpoint-routing";

const area = (b: Boundary) => (b.maxLat - b.minLat) * (b.maxLng - b.minLng);

/** セル 1 つ分の長方形 (1/64°) */
function cell(minLat: number, minLng: number): Boundary {
    const d = 1 / 64;
    return { minLat, minLng, maxLat: minLat + d, maxLng: minLng + d };
}

describe("intersect", () => {
    const a: Boundary = { minLat: 0, minLng: 0, maxLat: 10, maxLng: 10 };

    test("重なる部分を返す", () => {
        expect(intersect(a, { minLat: 5, minLng: 5, maxLat: 15, maxLng: 15 })).toEqual({
            minLat: 5,
            minLng: 5,
            maxLat: 10,
            maxLng: 10,
        });
    });

    test("内包される側を返す", () => {
        const inner: Boundary = { minLat: 2, minLng: 2, maxLat: 3, maxLng: 3 };
        expect(intersect(a, inner)).toEqual(inner);
    });

    test("接するだけなら null", () => {
        expect(intersect(a, { minLat: 10, minLng: 0, maxLat: 20, maxLng: 10 })).toBeNull();
    });

    test("離れていれば null", () => {
        expect(intersect(a, { minLat: 20, minLng: 20, maxLat: 30, maxLng: 30 })).toBeNull();
    });
});

describe("subtract", () => {
    const a: Boundary = { minLat: 0, minLng: 0, maxLat: 10, maxLng: 10 };

    test("重なりが無ければ元のまま", () => {
        expect(subtract(a, { minLat: 20, minLng: 20, maxLat: 30, maxLng: 30 })).toEqual([a]);
    });

    test("完全に覆われれば空", () => {
        expect(subtract(a, { minLat: -1, minLng: -1, maxLat: 11, maxLng: 11 })).toEqual([]);
    });

    test("中央を抜くと 4 つの長方形になり、面積が保存される", () => {
        const hole: Boundary = { minLat: 4, minLng: 4, maxLat: 6, maxLng: 6 };
        const parts = subtract(a, hole);
        expect(parts).toHaveLength(4);
        const total = parts.reduce((s, p) => s + area(p), 0);
        expect(total).toBeCloseTo(area(a) - area(hole), 9);
    });

    test("部分は互いに重ならない", () => {
        const parts = subtract(a, { minLat: 4, minLng: 4, maxLat: 6, maxLng: 6 });
        for (let i = 0; i < parts.length; i++) {
            for (let j = i + 1; j < parts.length; j++) {
                expect(intersect(parts[i], parts[j])).toBeNull();
            }
        }
    });

    test("一辺を削ると 1 つ", () => {
        const parts = subtract(a, { minLat: 0, minLng: 0, maxLat: 10, maxLng: 5 });
        expect(parts).toEqual([{ minLat: 0, minLng: 5, maxLat: 10, maxLng: 10 }]);
    });
});

describe("routeBoundaries", () => {
    const coverage: Boundary = { minLat: 30, minLng: 130, maxLat: 40, maxLng: 140 };

    test("カバレッジが null なら全て fallback (後方互換)", () => {
        const cells = [cell(35, 135), cell(36, 136)];
        expect(routeBoundaries(cells, null)).toEqual({ selfHosted: [], fallback: cells });
    });

    test("カバレッジ内は selfHosted", () => {
        const c = cell(35, 135);
        expect(routeBoundaries([c], coverage)).toEqual({ selfHosted: [c], fallback: [] });
    });

    test("カバレッジ外は fallback", () => {
        const c = cell(20, 120);
        expect(routeBoundaries([c], coverage)).toEqual({ selfHosted: [], fallback: [c] });
    });

    test("跨ぐセルは分割され、面積が保存される", () => {
        // カバレッジの南西の角をまたぐ 1 セル
        const straddle: Boundary = { minLat: 29.9, minLng: 129.9, maxLat: 30.1, maxLng: 130.1 };
        const { selfHosted, fallback } = routeBoundaries([straddle], coverage);
        expect(selfHosted).toHaveLength(1);
        const total = selfHosted.reduce((s, b) => s + area(b), 0)
            + fallback.reduce((s, b) => s + area(b), 0);
        expect(total).toBeCloseTo(area(straddle), 9);
    });

    test("内と外の混在を振り分ける", () => {
        const inside = cell(35, 135);
        const outside = cell(20, 120);
        const result = routeBoundaries([inside, outside], coverage);
        expect(result.selfHosted).toEqual([inside]);
        expect(result.fallback).toEqual([outside]);
    });

    test("日本全体のカバレッジで、長岡は内・国外は外", () => {
        const japan: Boundary = { minLat: 23.984375, minLng: 122.875, maxLat: 45.625, maxLng: 154.015625 };
        const nagaoka = cell(37.421875, 138.84375);
        const overseas = cell(48.8566, 2.3522); // パリ付近
        const result = routeBoundaries([nagaoka, overseas], japan);
        expect(result.selfHosted).toEqual([nagaoka]);
        expect(result.fallback).toEqual([overseas]);
    });
});

describe("parseCoverage", () => {
    test("正しい値", () => {
        expect(parseCoverage("23.984375,122.875,45.625,154.015625")).toEqual({
            minLat: 23.984375,
            maxLat: 45.625,
            minLng: 122.875,
            maxLng: 154.015625,
        });
    });

    test("空白を許す", () => {
        expect(parseCoverage(" 1 , 2 , 3 , 4 ")).toEqual({
            minLat: 1,
            maxLat: 3,
            minLng: 2,
            maxLng: 4,
        });
    });

    test("未設定・空文字は null", () => {
        expect(parseCoverage(undefined)).toBeNull();
        expect(parseCoverage("")).toBeNull();
        expect(parseCoverage("   ")).toBeNull();
    });

    test("要素数が違えば null (警告)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(parseCoverage("1,2,3")).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test("数値でなければ null (警告)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(parseCoverage("a,b,c,d")).toBeNull();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test("上下・左右が逆なら null (警告)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(parseCoverage("40,130,30,140")).toBeNull();
        expect(parseCoverage("30,140,40,130")).toBeNull();
        expect(warn).toHaveBeenCalledTimes(2);
        warn.mockRestore();
    });
});