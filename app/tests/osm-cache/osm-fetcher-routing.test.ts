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

const ok = (elements: unknown[]) => response(200, { elements });
const node = (id: number) => ({ type: "node", id, lat: 37.43, lon: 138.85 });

/** クエリ文字列から `way["highway"](...)` の bbox を順に取り出す */
function boundariesFromQuery(body: string): Boundary[] {
    const query = decodeURIComponent(new URLSearchParams(body).get("data") ?? "");
    const out: Boundary[] = [];
    const re = /way\["highway"\]\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/g;
    for (const m of query.matchAll(re)) {
        out.push({
            minLat: Number(m[1]),
            minLng: Number(m[2]),
            maxLat: Number(m[3]),
            maxLng: Number(m[4]),
        });
    }
    return out;
}

/** 呼び出しを 1 箇所で記録する fetch stub */
type Call = { endpoint: string; boundaries: Boundary[] };

function recordingFetch(handler: (call: Call) => unknown) {
    const calls: Call[] = [];
    const spy = vi.fn(async (endpoint: string, init: { body: string }) => {
        const call: Call = { endpoint, boundaries: boundariesFromQuery(init.body) };
        calls.push(call);
        const result = handler(call);
        return result instanceof Error ? Promise.reject(result) : result;
    });
    vi.stubGlobal("fetch", spy);
    return calls;
}

beforeEach(() => {
    vi.unstubAllGlobals();
    delete env.OVERPASS_ENDPOINT;
    delete env.OSM_SELF_HOSTED_ENDPOINT;
    delete env.OSM_SELF_HOSTED_COVERAGE;
});


describe("後方互換", () => {
    test("OSM_SELF_HOSTED_ENDPOINT 未設定なら外部だけに 1 回投げる", async () => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        const calls = recordingFetch(() => ok([node(1)]));

        const data = await fetchOverpassData([inside, outside]);

        expect(calls).toHaveLength(1);
        expect(calls[0].endpoint).toBe(FALLBACK);
        expect(calls[0].boundaries).toEqual([inside, outside]);
        expect(data.elements).toHaveLength(1);
    });

    test("coverage が無効なら外部だけを使う", async () => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        env.OSM_SELF_HOSTED_ENDPOINT = SELF;
        env.OSM_SELF_HOSTED_COVERAGE = "壊れた値";
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const calls = recordingFetch(() => ok([node(1)]));

        await fetchOverpassData([inside]);

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
        const calls = recordingFetch((c) => (c.endpoint === SELF ? ok([node(1)]) : ok([node(2)])));

        const data = await fetchOverpassData([inside]);

        expect(calls).toHaveLength(1);
        expect(calls[0].endpoint).toBe(SELF);
        expect(calls[0].boundaries).toEqual([inside]);
        expect(data.elements).toEqual([node(1)]);
    });

    test("カバレッジ外は外部へ送る", async () => {
        const calls = recordingFetch((c) => (c.endpoint === SELF ? ok([node(1)]) : ok([node(2)])));

        const data = await fetchOverpassData([outside]);

        expect(calls).toHaveLength(1);
        expect(calls[0].endpoint).toBe(FALLBACK);
        expect(calls[0].boundaries).toEqual([outside]);
        expect(data.elements).toEqual([node(2)]);
    });

    test("混在すれば自前と外部へ 1 回ずつ、結果を結合する", async () => {
        const calls = recordingFetch((c) =>
            c.endpoint === SELF ? ok([node(1), node(2)]) : ok([node(3)]),
        );

        const data = await fetchOverpassData([inside, outside]);

        const byEndpoint = new Map(calls.map((c) => [c.endpoint, c.boundaries]));
        expect(byEndpoint.get(SELF)).toEqual([inside]);
        expect(byEndpoint.get(FALLBACK)).toEqual([outside]);
        expect(calls).toHaveLength(2);
        expect(data.elements.map((e: { id: number }) => e.id).sort()).toEqual([1, 2, 3]);
    });

    test("同じ id は結合で重複しない", async () => {
        recordingFetch((c) => (c.endpoint === SELF ? ok([node(1)]) : ok([node(1), node(2)])));

        const data = await fetchOverpassData([inside, outside]);

        expect(data.elements.map((e: { id: number }) => e.id).sort()).toEqual([1, 2]);
    });
});


describe("自前の障害時の再送", () => {
    beforeEach(() => {
        env.OVERPASS_ENDPOINT = FALLBACK;
        env.OSM_SELF_HOSTED_ENDPOINT = SELF;
        env.OSM_SELF_HOSTED_COVERAGE = JAPAN;
        // 失敗ログでテスト出力が埋まるのを抑える
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    test("自前が 5xx なら、そのグループだけ外部へ再送する", async () => {
        const calls = recordingFetch((c) =>
            c.endpoint === SELF ? response(500, "boom") : ok([node(9)]),
        );

        const data = await fetchOverpassData([inside]);

        expect(calls.map((c) => c.endpoint)).toEqual([SELF, FALLBACK]);
        expect(calls[1].boundaries).toEqual([inside]);
        expect(data.elements).toEqual([node(9)]);
    });

    test("自前が remark なら、そのグループだけ外部へ再送する", async () => {
        const calls = recordingFetch((c) =>
            c.endpoint === SELF
                ? response(200, { elements: [], remark: "runtime error: Query timed out" })
                : ok([node(9)]),
        );

        const data = await fetchOverpassData([inside]);

        expect(calls.map((c) => c.endpoint)).toEqual([SELF, FALLBACK]);
        expect(calls[1].boundaries).toEqual([inside]);
        expect(data.elements).toEqual([node(9)]);
    });

    test("自前がネットワーク例外でも、そのグループだけ外部へ再送する", async () => {
        const calls = recordingFetch((c) => (c.endpoint === SELF ? new Error("ETIMEDOUT") : ok([node(9)])));

        const data = await fetchOverpassData([inside]);

        expect(calls.map((c) => c.endpoint)).toEqual([SELF, FALLBACK]);
        expect(calls[1].boundaries).toEqual([inside]);
        expect(data.elements).toEqual([node(9)]);
    });

    test("カバレッジ内の空は成功として扱い、外部へ再送しない (最重要)", async () => {
        // 外部にはデータを用意しておく。再送してしまえば node 9 が返るので、
        // 呼ばれないことを空のまま返ることで確かめられる
        const calls = recordingFetch((c) => (c.endpoint === SELF ? ok([]) : ok([node(9)])));

        const data = await fetchOverpassData([inside]);

        expect(calls.map((c) => c.endpoint)).toEqual([SELF]);
        expect(data.elements).toEqual([]);
    });
});