import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Boundary } from "../../src/lib/osm/boundary";

const { env } = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env }));

import { requireOSMData } from "../../src/lib/osm";
import { fetchOverpassData } from "../../src/lib/osm/osm-fetcher";
import { RequestContext } from "$lib/tracing/requestContext";

const SELF = "http://127.0.0.1:3001/api/interpreter";
const FALLBACK = "https://overpass.example.test/api";

// カバレッジの境界を 1/64° から意図的にずらし、セルを跨がせる。
// 37.43 は 1/64° の倍数ではない。実カバレッジは倍数なので跨ぎが起きない。
const COVERAGE = "0,0,37.43,180";

// 跨がれるセル (lat 37.421875..37.4375)
const CELL: Boundary = { minLat: 37.421875, minLng: 138.84375, maxLat: 37.4375, maxLng: 138.859375 };

/** 跨ぎの内側 (lat 37.421875..37.43) */
const INSIDE_PART: Boundary = { minLat: 37.421875, minLng: 138.84375, maxLat: 37.43, maxLng: 138.859375 };
/** 跨ぎの外側 (lat 37.43..37.4375) */
const OUTSIDE_PART: Boundary = { minLat: 37.43, minLng: 138.84375, maxLat: 37.4375, maxLng: 138.859375 };

function response(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "Mocked",
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

function boundariesFromQuery(body: string): Boundary[] {
    const query = decodeURIComponent(new URLSearchParams(body).get("data") ?? "");
    const out: Boundary[] = [];
    const re = /way\["highway"\]\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/g;
    for (const m of query.matchAll(re)) {
        out.push({ minLat: Number(m[1]), minLng: Number(m[2]), maxLat: Number(m[3]), maxLng: Number(m[4]) });
    }
    return out;
}

type Call = { endpoint: string; boundaries: Boundary[] };

/** endpoint ごとに要素を返しつつ、呼び出しを記録する stub */
function recordingFetch() {
    const calls: Call[] = [];
    const spy = vi.fn(async (endpoint: string, init: { body: string }) => {
        calls.push({ endpoint, boundaries: boundariesFromQuery(init.body) });
        if (endpoint === SELF) {
            // 内側の way。ノードの lat は跨ぎの下側
            return response(200, {
                elements: [
                    { type: "way", id: 101, nodes: [11], tags: { highway: "residential" } },
                    { type: "node", id: 11, lat: 37.425, lon: 138.85 },
                ],
            });
        }
        // 外側の way。ノードの lat は跨ぎの上側
        return response(200, {
            elements: [
                { type: "way", id: 102, nodes: [12], tags: { highway: "residential" } },
                { type: "node", id: 12, lat: 37.435, lon: 138.85 },
            ],
        });
    });
    vi.stubGlobal("fetch", spy);
    return calls;
}

beforeEach(() => {
    vi.unstubAllGlobals();
    env.OVERPASS_ENDPOINT = FALLBACK;
    env.OSM_SELF_HOSTED_ENDPOINT = SELF;
    env.OSM_SELF_HOSTED_COVERAGE = COVERAGE;
});

describe("カバレッジ境界をまたぐセル (requireOSMData 経由)", () => {
    test("跨いだセルに両側の要素が入り、合わせた内容でキャッシュされる", async () => {
        const calls = recordingFetch();
        const saved: { bound: Boundary; data: App.OSMData }[] = [];
        const cache = {
            readCache: vi.fn().mockResolvedValue(null),
            saveCache: vi.fn(async (bound: Boundary, data: App.OSMData) => {
                saved.push({ bound, data });
            }),
        };

        await requireOSMData(new RequestContext(new Date(), "POST", "/test"), CELL, cache, fetchOverpassData);

        // 内側は自前、外側は外部へ分かれて飛ぶ
        const byEndpoint = new Map(calls.map((c) => [c.endpoint, c.boundaries]));
        expect(byEndpoint.get(SELF)).toEqual([INSIDE_PART]);
        expect(byEndpoint.get(FALLBACK)).toEqual([OUTSIDE_PART]);

        // そのセルが取得済みとして保存される
        expect(saved).toHaveLength(1);
        expect(saved[0].bound).toEqual(CELL);

        // 中身は両側を合わせたもの (片側だけではない)
        const ids = saved[0].data.elements.map((e) => e.id).sort((a, b) => a - b);
        expect(ids).toEqual([11, 12, 101, 102]);
        const wayIds = saved[0].data.elements.filter((e) => e.type === "way").map((e) => e.id);
        expect(wayIds.sort((a, b) => a - b)).toEqual([101, 102]);
    });
});