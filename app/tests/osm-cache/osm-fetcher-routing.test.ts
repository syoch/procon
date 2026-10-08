import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Boundary } from "../../src/lib/osm/boundary";

const { env } = vi.hoisted(() => ({
    env: {} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env }));

import { fetchOverpassData } from "../../src/lib/osm/osm-fetcher";

const SELF = "http://127.0.0.1:3001/api/interpreter";
const FALLBACK = "https://overpass.example.test/api";

/** 日本全体を覆うカバレッジ */
const JAPAN = "23.984375,122.875,45.625,154.015625";

const inside: Boundary = { minLat: 37.421875, minLng: 138.84375, maxLat: 37.4375, maxLng: 138.859375 };
const outside: Boundary = { minLat: 48.85, minLng: 2.35, maxLat: 48.87, maxLng: 2.37 };

function response(status: number, body: unknown) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "Mocked",
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

/** URL ごとに応答を返し、呼ばれた URL を記録する fetch */
function mockFetch(routes: Record<string, unknown>) {
    const calls: string[] = [];
    const spy = vi.fn(async (url: string) => {
        calls.push(url);
        if (!(url in routes)) throw new Error(`unexpected url: ${url}`);
        const route = routes[url];
        return route instanceof Error ? Promise.reject(route) : route;
    });
    vi.stubGlobal("fetch", spy);
    return { spy, calls };
}

const node = (id: number) => ({ type: "node", id, lat: 37.43, lon: 138.85 });
const ok = (elements: unknown[]) => response(200, { elements });

beforeEach(() => {
    vi.unstubAllGlobals();
    delete env.OVERPASS_ENDPOINT;
    delete env.OSM_SELF_HOSTED_ENDPOINT;
    delete env.OSM_SELF_HOSTED_COVERAGE;
});

describe("後方互換", () => {
    test("OSM_SELF_HOSTED_ENDPOINT 未設定なら外部だけに 1 回投げる", async () => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        const { calls } = mockFetch({ [FALLBACK]: ok([node(1)]) });

        const data = await fetchOverpassData([inside, outside]);

        expect(calls).toEqual([FALLBACK]);
        expect(data.elements).toHaveLength(1);
    });

    test("coverage が無効なら外部だけを使う", async () => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        env.OSM_SELF_HOSTED_ENDPOINT = SELF;
        env.OSM_SELF_HOSTED_COVERAGE = "壊れた値";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { calls } = mockFetch({ [FALLBACK]: ok([node(1)]) });

        await fetchOverpassData([inside]);

        expect(calls).toEqual([FALLBACK]);
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

    test("カバレッジ内だけなら自前へ 1 回", async () => {
        const { calls } = mockFetch({ [SELF]: ok([node(1)]), [FALLBACK]: ok([node(2)]) });

        const data = await fetchOverpassData([inside]);

        expect(calls).toEqual([SELF]);
        expect(data.elements).toEqual([node(1)]);
    });

    test("カバレッジ外だけなら外部へ 1 回", async () => {
        const { calls } = mockFetch({ [SELF]: ok([node(1)]), [FALLBACK]: ok([node(2)]) });

        const data = await fetchOverpassData([outside]);

        expect(calls).toEqual([FALLBACK]);
        expect(data.elements).toEqual([node(2)]);
    });

    test("混在すれば 2 回に分けて merge する", async () => {
        const { calls } = mockFetch({
            [SELF]: ok([node(1), node(2)]),
            [FALLBACK]: ok([node(3)]),
        });

        const data = await fetchOverpassData([inside, outside]);

        expect(calls.sort()).toEqual([SELF, FALLBACK].sort());
        expect(data.elements.map((e: { id: number }) => e.id).sort()).toEqual([1, 2, 3]);
    });

    test("同じ id は merge で重複しない", async () => {
        mockFetch({
            [SELF]: ok([node(1)]),
            [FALLBACK]: ok([node(1), node(2)]),
        });

        const data = await fetchOverpassData([inside, outside]);

        expect(data.elements.map((e: { id: number }) => e.id).sort()).toEqual([1, 2]);
    });
});

describe("自前の障害時の再送", () => {
    beforeEach(() => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        env.OSM_SELF_HOSTED_ENDPOINT = SELF;
        env.OSM_SELF_HOSTED_COVERAGE = JAPAN;
    });

    test("自前が 500 ならそのグループだけ外部へ再送", async () => {
        const { calls } = mockFetch({
            [SELF]: response(500, "boom"),
            [FALLBACK]: ok([node(9)]),
        });

        const data = await fetchOverpassData([inside]);

        expect(calls).toEqual([SELF, FALLBACK]);
        expect(data.elements).toEqual([node(9)]);
    });

    test("自前が remark ならそのグループだけ外部へ再送", async () => {
        const { calls } = mockFetch({
            [SELF]: response(200, { elements: [], remark: "runtime error: Query timed out" }),
            [FALLBACK]: ok([node(9)]),
        });

        const data = await fetchOverpassData([inside]);

        expect(calls).toEqual([SELF, FALLBACK]);
        expect(data.elements).toEqual([node(9)]);
    });

    test("自前がネットワーク例外でも再送", async () => {
        const { calls } = mockFetch({
            [SELF]: new Error("ETIMEDOUT"),
            [FALLBACK]: ok([node(9)]),
        });

        const data = await fetchOverpassData([inside]);

        expect(calls).toEqual([SELF, FALLBACK]);
        expect(data.elements).toEqual([node(9)]);
    });

    test("カバレッジ内の空は成功として扱い、外部へ再送しない (最重要)", async () => {
        const { calls } = mockFetch({
            [SELF]: ok([]),
            [FALLBACK]: ok([node(9)]),
        });

        const data = await fetchOverpassData([inside]);

        // 空は「本当に道が無い」なので外部へ回さない
        expect(calls).toEqual([SELF]);
        expect(data.elements).toEqual([]);
    });
});