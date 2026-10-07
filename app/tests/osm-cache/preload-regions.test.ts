import { describe, expect, test } from "vitest";

import { deltaLatitude } from "../../src/lib/osm/grid";
import { divideBoundary } from "../../src/lib/osm/boundary";
import { PRELOAD_REGIONS, regionNames } from "../../bench/scripts/preload-regions";

/**
 * デモ用領域の bbox がセル境界に一致していること。
 *
 * `divideBoundary` は外側へ切り上げるので、
 * 未スナップの値をそのまま書くと 1 セル余ってセル数と容量の見積もりがずれる。
 */
describe("デモ用領域", () => {
    test("全ての bbox がセル境界に乗る", () => {
        for (const [name, region] of Object.entries(PRELOAD_REGIONS)) {
            for (const value of [
                region.boundary.minLat,
                region.boundary.maxLat,
                region.boundary.minLng,
                region.boundary.maxLng,
            ]) {
                const cells = value / deltaLatitude;
                expect(Math.abs(cells - Math.round(cells)), `${name}: ${value}`).toBeLessThan(1e-9);
            }
        }
    });

    test("divideBoundary のセル数が bbox の格子数と一致する", () => {
        for (const [name, region] of Object.entries(PRELOAD_REGIONS)) {
            const latCells = (region.boundary.maxLat - region.boundary.minLat) / deltaLatitude;
            const lngCells = (region.boundary.maxLng - region.boundary.minLng) / deltaLatitude;
            expect(divideBoundary(region.boundary).length, name).toBe(latCells * lngCells);
        }
    });

    test("divideBoundary は bbox を外へ切り出さない", () => {
        for (const region of Object.values(PRELOAD_REGIONS)) {
            const cells = divideBoundary(region.boundary);
            const minLat = Math.min(...cells.map((c) => c.minLat));
            const minLng = Math.min(...cells.map((c) => c.minLng));
            const maxLat = Math.max(...cells.map((c) => c.maxLat));
            const maxLng = Math.max(...cells.map((c) => c.maxLng));
            expect(minLat).toBeLessThanOrEqual(region.boundary.minLat);
            expect(minLng).toBeLessThanOrEqual(region.boundary.minLng);
            expect(maxLat).toBeGreaterThanOrEqual(region.boundary.maxLat);
            expect(maxLng).toBeGreaterThanOrEqual(region.boundary.maxLng);
        }
    });

    test("本選会場を含む (サンポートホール高松 34.3524, 134.0472)", () => {
        const { minLat, minLng, maxLat, maxLng } = PRELOAD_REGIONS.takamatsu.boundary;
        expect(34.3524).toBeGreaterThanOrEqual(minLat);
        expect(34.3524).toBeLessThanOrEqual(maxLat);
        expect(134.0472).toBeGreaterThanOrEqual(minLng);
        expect(134.0472).toBeLessThanOrEqual(maxLng);
    });

    test("東京駅を含む (35.6812, 139.7671)", () => {
        const { minLat, minLng, maxLat, maxLng } = PRELOAD_REGIONS.tokyo.boundary;
        expect(35.6812).toBeGreaterThanOrEqual(minLat);
        expect(35.6812).toBeLessThanOrEqual(maxLat);
        expect(139.7671).toBeGreaterThanOrEqual(minLng);
        expect(139.7671).toBeLessThanOrEqual(maxLng);
    });

    test("1 クエリ 64 セルで 4 クエリ以内に収まる", () => {
        for (const [name, region] of Object.entries(PRELOAD_REGIONS)) {
            expect(divideBoundary(region.boundary).length, name).toBeLessThanOrEqual(64 * 4);
        }
    });

    test("領域名は領域定義と一致する", () => {
        expect(regionNames()).toEqual(Object.keys(PRELOAD_REGIONS));
        expect(regionNames()).toContain("takamatsu");
        expect(regionNames()).toContain("tokyo");
    });
});