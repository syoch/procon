import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Boundary } from "../../src/lib/osm/boundary";
import type { OverpassEndpointFetcher } from "../../src/lib/osm/types";

const { env } = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env }));

import { requireOSMData } from "../../src/lib/osm";
import { createOverpassFetcher } from "../../src/lib/osm/osm-fetcher";
import { RequestContext } from "$lib/tracing/requestContext";

const SELF = "http://127.0.0.1:3001/api/interpreter";
const FALLBACK = "https://overpass.example.test/api";

// カバレッジの境界を 1/64° から意図的にずらし、セルを跨がせる。
// 37.43 は 1/64° の倍数ではない。実カバレッジは倍数なので跨ぎが起きない。
const COVERAGE = "0,0,37.43,180";

// 跨がれるセル (lat 37.421875..37.4375)
const CELL: Boundary = { minLat: 37.421875, minLng: 138.84375, maxLat: 37.4375, maxLng: 138.859375 };

// カバレッジに完全に含まれるセル (lat 37.0..37.015625)
const INSIDE_CELL: Boundary = { minLat: 37.0, minLng: 138.0, maxLat: 37.015625, maxLng: 138.015625 };

type Call = { endpoint: string; boundaries: Boundary[] };

/** endpoint ごとに ways を返しつつ、呼び出しを記録する偽の低レベル fetcher */
function fakeFetch(): { fetch: OverpassEndpointFetcher; calls: Call[] } {
    const calls: Call[] = [];
    const fetch: OverpassEndpointFetcher = async (endpoint, boundaries) => {
        calls.push({ endpoint, boundaries });
        if (endpoint === SELF) {
            // 内側の way。ノードの lat は跨ぎの下側
            return {
                elements: [
                    { type: "way", id: 101, nodes: [11], tags: { highway: "residential" } },
                    { type: "node", id: 11, lat: 37.425, lon: 138.85 },
                ],
            };
        }
        // 外部の way。ノードの lat は跨ぎの上側
        return {
            elements: [
                { type: "way", id: 102, nodes: [12], tags: { highway: "residential" } },
                { type: "node", id: 12, lat: 37.435, lon: 138.85 },
            ],
        };
    };
    return { fetch, calls };
}

beforeEach(() => {
    env.OVERPASS_ENDPOINT = FALLBACK;
    env.OSM_SELF_HOSTED_ENDPOINT = SELF;
    env.OSM_SELF_HOSTED_COVERAGE = COVERAGE;
});

describe("カバレッジ境界をまたぐセル (requireOSMData 経由)", () => {
    test("跨ぐセルは丸ごと外部へ送られ、そのセルがキャッシュされる", async () => {
        const { fetch, calls } = fakeFetch();
        const routed = createOverpassFetcher(fetch);
        const saved: { bound: Boundary; data: App.OSMData }[] = [];
        const cache = {
            readCache: vi.fn().mockResolvedValue(null),
            saveCache: vi.fn(async (bound: Boundary, data: App.OSMData) => {
                saved.push({ bound, data });
            }),
        };

        await requireOSMData(new RequestContext(new Date(), "POST", "/test"), CELL, cache, routed);

        // 1. 自己ホストは呼ばれない
        expect(calls.some((c) => c.endpoint === SELF)).toBe(false);
        // 2. 外部がそのセル全体で 1 回呼ばれる
        expect(calls).toEqual([{ endpoint: FALLBACK, boundaries: [CELL] }]);
        // 3. 外部の結果なので、そのセルがキャッシュされる
        expect(saved).toHaveLength(1);
        expect(saved[0].bound).toEqual(CELL);
        expect(saved[0].data.elements.map((e) => e.id).sort((a, b) => a - b)).toEqual([12, 102]);
    });

    test("完全に内のセルは自前から取り、キャッシュしない", async () => {
        const { fetch, calls } = fakeFetch();
        const routed = createOverpassFetcher(fetch);
        const saveCache = vi.fn();
        const cache = { readCache: vi.fn().mockResolvedValue(null), saveCache };

        await requireOSMData(new RequestContext(new Date(), "POST", "/test"), INSIDE_CELL, cache, routed);

        // 自前が担当する
        expect(calls).toEqual([{ endpoint: SELF, boundaries: [INSIDE_CELL] }]);
        // 自前の結果はキャッシュしない
        expect(saveCache).not.toHaveBeenCalled();
    });
});