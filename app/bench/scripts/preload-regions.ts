/**
 * デモで使う領域の定義。
 *
 * セルの集合は `getBoundaryBox(南西の角, 北東の角)` で定義する。
 * サーバは経路探索でも同じ関数を使い、周囲 1 セルを余白として足す。
 * 手で ±1 するのではなく、サーバと同じ関数を使うことで、
 * プリロードするセル集合と経路探索が要求するセル集合を一致させる。
 *
 * @ref ../../../src/lib/osm/path-boundary.ts
 * @ref README.md#デモ用領域のプリロード
 */
import type { Boundary } from "../../src/lib/osm/boundary";
import { getBoundaryBox } from "../../src/lib/osm/path-boundary";

export type PreloadRegion = {
    /** この領域を温める理由 */
    description: string;
    /** 南西の角。サーバへ送る `begin` になる */
    southWest: App.Coordinate;
    /** 北東の角。サーバへ送る `end` になる */
    northEast: App.Coordinate;
    /** `getBoundaryBox(southWest, northEast)` の結果。余白 1 セルを含む */
    boundary: Boundary;
};

/** `southWest` / `northEast` から、余白を含む `boundary` を組む */
function region(
    description: string,
    southWest: App.Coordinate,
    northEast: App.Coordinate,
): PreloadRegion {
    return {
        description,
        southWest,
        northEast,
        boundary: getBoundaryBox(southWest, northEast),
    };
}

/**
 * 本選（香川・高松）と東京、長岡の 3 領域。
 *
 * 角は「デモで使う範囲」をそのまま書く。余白は `getBoundaryBox` が足す。
 * 高松は会場のサンポートホール高松（34.3524, 134.0472）を中心に、
 * 高松駅・高松港・高松空港までを含める。
 * 東京は東京駅・新宿・渋谷・浅草・羽田・横浜駅までを含める。
 * 長岡は長岡駅・長岡プラザ（デモの OD A）を含める。
 */
export const PRELOAD_REGIONS: Record<string, PreloadRegion> = {
    takamatsu: region(
        "本選会場周辺（サンポートホール高松・高松駅・高松港・高松空港）",
        { lat: 34.1875, lng: 133.984375 },
        { lat: 34.375, lng: 134.078125 },
    ),
    tokyo: region(
        "東京周辺（東京駅・新宿・渋谷・浅草・羽田・横浜駅）",
        { lat: 35.4375, lng: 139.625 },
        { lat: 35.703125, lng: 139.78125 },
    ),
    nagaoka: region(
        "長岡中心部（長岡駅・長岡プラザ）",
        { lat: 37.421875, lng: 138.84375 },
        { lat: 37.46875, lng: 138.890625 },
    ),
};

/** 領域名の一覧。既定では全部を温める */
export function regionNames(): string[] {
    return Object.keys(PRELOAD_REGIONS);
}