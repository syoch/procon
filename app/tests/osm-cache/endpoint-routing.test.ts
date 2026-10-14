import { describe, expect, test, vi } from "vitest";

import type { Boundary } from "../../src/lib/osm/boundary";
import {
    containsBoundary,
    parseCoverage,
    routeBoundaries,
} from "../../src/lib/osm/endpoint-routing";

/** セル 1 つ分の長方形 (1/64°) */
function cell(minLat: number, minLng: number): Boundary {
    const d = 1 / 64;
    return { minLat, minLng, maxLat: minLat + d, maxLng: minLng + d };
}

describe("containsBoundary", () => {
    const outer: Boundary = { minLat: 0, minLng: 0, maxLat: 10, maxLng: 10 };

    test("内包される", () => {
        expect(containsBoundary(outer, { minLat: 2, minLng: 2, maxLat: 3, maxLng: 3 })).toBe(true);
    });

    test("境界が一致すれば含む", () => {
        expect(containsBoundary(outer, outer)).toBe(true);
    });

    test("一部だけ重なるのは含まない", () => {
        expect(containsBoundary(outer, { minLat: 5, minLng: 5, maxLat: 15, maxLng: 15 })).toBe(false);
    });

    test("接するだけなら含まない", () => {
        expect(containsBoundary(outer, { minLat: 10, minLng: 0, maxLat: 20, maxLng: 10 })).toBe(false);
    });

    test("完全に外は含まない", () => {
        expect(containsBoundary(outer, { minLat: 20, minLng: 20, maxLat: 30, maxLng: 30 })).toBe(false);
    });
});

describe("routeBoundaries", () => {
    const coverage: Boundary = { minLat: 30, minLng: 130, maxLat: 40, maxLng: 140 };

    test("カバレッジが null なら全て fallback (後方互換)", () => {
        const cells = [cell(35, 135), cell(36, 136)];
        expect(routeBoundaries(cells, null)).toEqual({ selfHosted: [], fallback: cells });
    });

    test("完全に内は selfHosted", () => {
        const c = cell(35, 135);
        expect(routeBoundaries([c], coverage)).toEqual({ selfHosted: [c], fallback: [] });
    });

    test("完全に外は fallback", () => {
        const c = cell(20, 120);
        expect(routeBoundaries([c], coverage)).toEqual({ selfHosted: [], fallback: [c] });
    });

    test("跨ぐ長方形は分割せず丸ごと fallback", () => {
        // カバレッジの南西の角をまたぐ 1 セル
        const straddle: Boundary = { minLat: 29.9, minLng: 129.9, maxLat: 30.1, maxLng: 130.1 };
        expect(routeBoundaries([straddle], coverage)).toEqual({ selfHosted: [], fallback: [straddle] });
    });

    test("内と外の混在を振り分ける", () => {
        const inside = cell(35, 135);
        const outside = cell(20, 120);
        expect(routeBoundaries([inside, outside], coverage)).toEqual({
            selfHosted: [inside],
            fallback: [outside],
        });
    });

    test("日本全体のカバレッジで、長岡は内・国外は外", () => {
        const japan: Boundary = { minLat: 23.984375, minLng: 122.875, maxLat: 45.625, maxLng: 154.015625 };
        const nagaoka = cell(37.421875, 138.84375);
        const overseas = cell(48.8566, 2.3522); // パリ付近
        expect(routeBoundaries([nagaoka, overseas], japan)).toEqual({
            selfHosted: [nagaoka],
            fallback: [overseas],
        });
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