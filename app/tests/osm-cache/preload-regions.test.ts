import { describe, expect, test } from "vitest";

import { deltaLatitude } from "../../src/lib/osm/grid";
import { divideBoundary } from "../../src/lib/osm/boundary";
import { getBoundaryBox } from "../../src/lib/osm/path-boundary";
import { PRELOAD_REGIONS, regionNames } from "../../bench/scripts/preload-regions";

/**
 * デモ用領域のセル集合が、サーバの経路探索と同じ `getBoundaryBox` で
 * 定義されていること。
 *
 * サーバは経路探索でも `/api/preload-osm` でも `getBoundaryBox` を使って
 * 周囲 1 セルを余白として足す。領域定義がこれと一致していないと、
 * プリロードしたセルだけでは経路探索が要求するセルを満たせない。
 */
describe("デモ用領域", () => {
    test("boundary は getBoundaryBox(southWest, northEast) と一致する", () => {
        for (const [name, region] of Object.entries(PRELOAD_REGIONS)) {
            expect(region.boundary, name).toEqual(getBoundaryBox(region.southWest, region.northEast));
        }
    });

    test("boundary が southWest / northEast より 1 セル広い", () => {
        for (const [name, region] of Object.entries(PRELOAD_REGIONS)) {
            expect(region.boundary.minLat, name).toBeCloseTo(region.southWest.lat - deltaLatitude, 9);
            expect(region.boundary.minLng, name).toBeCloseTo(region.southWest.lng - deltaLatitude, 9);
            expect(region.boundary.maxLat, name).toBeCloseTo(region.northEast.lat + deltaLatitude, 9);
            expect(region.boundary.maxLng, name).toBeCloseTo(region.northEast.lng + deltaLatitude, 9);
        }
    });

    test("boundary がセル境界に乗る", () => {
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

    test("長岡駅を含む (37.4472, 138.8538)", () => {
        const { minLat, minLng, maxLat, maxLng } = PRELOAD_REGIONS.nagaoka.boundary;
        expect(37.4472).toBeGreaterThanOrEqual(minLat);
        expect(37.4472).toBeLessThanOrEqual(maxLat);
        expect(138.8538).toBeGreaterThanOrEqual(minLng);
        expect(138.8538).toBeLessThanOrEqual(maxLng);
    });

    test("領域名は領域定義と一致する", () => {
        expect(regionNames()).toEqual(Object.keys(PRELOAD_REGIONS));
        expect(regionNames().sort()).toEqual(["nagaoka", "takamatsu", "tokyo"]);
    });
});