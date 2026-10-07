/**
 * デモで使う領域の定義。
 *
 * bbox はセル境界（1/64°）にスナップした値で書く。
 * `divideBoundary` は指定より外側を切り上げるので、
 * 未スナップの値をそのまま渡すと 1 セル余る。
 *
 * @ref README.md#デモ用領域のプリロード
 */
import type { Boundary } from "../../src/lib/osm/boundary";

export type PreloadRegion = {
    /** この領域を温める理由 */
    description: string;
    boundary: Boundary;
};

/**
 * 本選（香川・高松）と東京の 2 領域。
 *
 * 高松は会場のサンポートホール高松（34.3524, 134.0472）を中心に、
 * 高松駅・高松港・高松空港までを含める。
 * 東京は東京駅・新宿・渋谷・浅草・羽田・横浜駅までを含める。
 */
export const PRELOAD_REGIONS: Record<string, PreloadRegion> = {
    takamatsu: {
        description: "本選会場周辺（サンポートホール高松・高松駅・高松港・高松空港）",
        boundary: {
            minLat: 34.1875,
            minLng: 133.984375,
            maxLat: 34.375,
            maxLng: 134.078125,
        },
    },
    tokyo: {
        description: "東京周辺（東京駅・新宿・渋谷・浅草・羽田・横浜駅）",
        boundary: {
            minLat: 35.4375,
            minLng: 139.625,
            maxLat: 35.703125,
            maxLng: 139.78125,
        },
    },
};

/** 領域名の一覧。既定では全部を温める */
export function regionNames(): string[] {
    return Object.keys(PRELOAD_REGIONS);
}