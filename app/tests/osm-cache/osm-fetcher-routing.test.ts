import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Boundary } from "../../src/lib/osm/boundary";
import type { OverpassEndpointFetcher } from "../../src/lib/osm/types";
import { createOverpassFetcher } from "../../src/lib/osm/osm-fetcher";

const { env } = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env }));

const SELF = "http://127.0.0.1:3001/api/interpreter";
const FALLBACK = "https://overpass.example.test/api";

/** 日本全体を覆うカバレッジ */
const JAPAN = "23.984375,122.875,45.625,154.015625";

const inside: Boundary = { minLat: 37.421875, minLng: 138.84375, maxLat: 37.4375, maxLng: 138.859375 };
const outside: Boundary = { minLat: 48.85, minLng: 2.35, maxLat: 48.87, maxLng: 2.37 };

const node = (id: number) => ({ type: "node", id, lat: 37.43, lon: 138.85 });
const ok = (elements: unknown[]) => ({ elements }) as App.OSMData;

/** (endpoint, boundaries) の呼び出しを記録する偽の低レベル fetcher */
type Call = { endpoint: string; boundaries: Boundary[] };

function fakeFetch(handler: (call: Call) => App.OSMData) {
    const calls: Call[] = [];
    const fetch: OverpassEndpointFetcher = async (endpoint, boundaries) => {
        const call = { endpoint, boundaries };
        calls.push(call);
        return handler(call);
    };
    return { fetch, calls };
}

beforeEach(() => {
    delete env.OVERPASS_ENDPOINT;
    delete env.OSM_SELF_HOSTED_ENDPOINT;
    delete env.OSM_SELF_HOSTED_COVERAGE;
});


describe("後方互換", () => {
    test("OSM_SELF_HOSTED_ENDPOINT 未設定なら外部だけに 1 回投げる", async () => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        const { fetch, calls } = fakeFetch(() => ok([node(1)]));
        const routed = createOverpassFetcher(fetch);

        const data = await routed([inside, outside]);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ endpoint: FALLBACK, boundaries: [inside, outside] });
        expect(data.elements).toHaveLength(1);
    });

    test("coverage が無効なら外部だけを使う", async () => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        env.OSM_SELF_HOSTED_ENDPOINT = SELF;
        env.OSM_SELF_HOSTED_COVERAGE = "壊れた値";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { fetch, calls } = fakeFetch(() => ok([node(1)]));
        const routed = createOverpassFetcher(fetch);

        await routed([inside]);

        expect(calls).toHaveLength(1);
        expect(calls[0].endpoint).toBe(FALLBACK);
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});


describe("セル単位の振り分け", () => {
    beforeEach(() => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        env.OSM_SELF_HOSTED_ENDPOINT = SELF;
        env.OSM_SELF_HOSTED_COVERAGE = JAPAN;
    });

    test("カバレッジ内は自前へ送る", async () => {
        const { fetch, calls } = fakeFetch((c) => (c.endpoint === SELF ? ok([node(1)]) : ok([node(2)])));
        const routed = createOverpassFetcher(fetch);

        const data = await routed([inside]);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ endpoint: SELF, boundaries: [inside] });
        expect(data.elements).toEqual([node(1)]);
    });

    test("カバレッジ外は外部へ送る", async () => {
        const { fetch, calls } = fakeFetch((c) => (c.endpoint === SELF ? ok([node(1)]) : ok([node(2)])));
        const routed = createOverpassFetcher(fetch);

        const data = await routed([outside]);

        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ endpoint: FALLBACK, boundaries: [outside] });
        expect(data.elements).toEqual([node(2)]);
    });

    test("混在すれば自前と外部へ 1 回ずつ、結果を結合する", async () => {
        const { fetch, calls } = fakeFetch((c) =>
            c.endpoint === SELF ? ok([node(1), node(2)]) : ok([node(3)]),
        );
        const routed = createOverpassFetcher(fetch);

        const data = await routed([inside, outside]);

        const byEndpoint = new Map(calls.map((c) => [c.endpoint, c.boundaries]));
        expect(byEndpoint.get(SELF)).toEqual([inside]);
        expect(byEndpoint.get(FALLBACK)).toEqual([outside]);
        expect(calls).toHaveLength(2);
        expect(data.elements.map((e: { id: number }) => e.id).sort()).toEqual([1, 2, 3]);
    });

    test("同じ id は結合で重複しない", async () => {
        const { fetch } = fakeFetch((c) => (c.endpoint === SELF ? ok([node(1)]) : ok([node(1), node(2)])));
        const routed = createOverpassFetcher(fetch);

        const data = await routed([inside, outside]);

        expect(data.elements.map((e: { id: number }) => e.id).sort()).toEqual([1, 2]);
    });
});


describe("自前の障害時の再送", () => {
    beforeEach(() => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        env.OSM_SELF_HOSTED_ENDPOINT = SELF;
        env.OSM_SELF_HOSTED_COVERAGE = JAPAN;
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    test("自前が throw したら、そのグループだけ外部へ再送する", async () => {
        const { fetch, calls } = fakeFetch((c) => {
            if (c.endpoint === SELF) throw new Error("Overpass API エラー: 500");
            return ok([node(9)]);
        });
        const routed = createOverpassFetcher(fetch);

        const data = await routed([inside]);

        expect(calls.map((c) => c.endpoint)).toEqual([SELF, FALLBACK]);
        expect(calls[1].boundaries).toEqual([inside]);
        expect(data.elements).toEqual([node(9)]);
    });

    test("カバレッジ内の空は成功として扱い、外部へ再送しない (最重要)", async () => {
        // 外部にはデータを用意しておく。再送してしまえば node 9 が返るので、
        // 呼ばれないことを空のまま返ることで確かめられる
        const { fetch, calls } = fakeFetch((c) => (c.endpoint === SELF ? ok([]) : ok([node(9)])));
        const routed = createOverpassFetcher(fetch);

        const data = await routed([inside]);

        expect(calls.map((c) => c.endpoint)).toEqual([SELF]);
        expect(data.elements).toEqual([]);
    });
});