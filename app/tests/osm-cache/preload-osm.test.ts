import { beforeEach, describe, expect, test, vi } from "vitest";
import { getBoundaryBox } from "../../src/lib/osm/path-boundary";

const { requireOSMData } = vi.hoisted(() => ({
  requireOSMData: vi.fn(async (_reqCtx: unknown, _bbox: unknown) => ({ elements: [] })),
}));

const { env } = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
}));

vi.mock("$env/dynamic/private", () => ({ env }));
vi.mock("../../src/lib/osm", () => ({
  requireOSMData,
  OSMCellLimitError: class OSMCellLimitError extends Error {},
}));
vi.mock("../../src/lib/osm/fs-cache-manager", () => ({ cacheManager: {} }));
vi.mock("../../src/lib/osm/osm-fetcher", () => ({ overpassFetcher: vi.fn() }));

import { POST } from "../../src/routes/api/preload-osm/+server";

const SELF = "http://127.0.0.1:3001/api/interpreter";

beforeEach(() => {
  requireOSMData.mockClear();
  delete env.OSM_SELF_HOSTED_ENDPOINT;
  delete env.OSM_SELF_HOSTED_COVERAGE;
});

function post(body: unknown) {
  const request = { json: async () => body } as unknown as globalThis.Request;
  return POST({ request } as never);
}

// 長岡市中心の端点。bbox は lat 37.4375..37.453125 / lng 138.84375..138.859375
const begin = { lat: 37.448, lng: 138.853 };
const end = { lat: 37.441, lng: 138.868 };

test("両端点からは経路探索と同じ範囲を温める", async () => {
  const res = await post({ begin, end });

  expect(res.status).toBe(200);
  expect(requireOSMData.mock.calls[0][1]).toEqual(getBoundaryBox(begin, end));
});

test("片端点だけならその周辺を温める", async () => {
  const res = await post({ begin });

  expect(res.status).toBe(200);
  expect(requireOSMData.mock.calls[0][1]).toEqual(getBoundaryBox(begin, begin));
});

test("端点が無ければ 400", async () => {
  const res = await post({});
  expect(res.status).toBe(400);
  expect(requireOSMData).not.toHaveBeenCalled();
});

describe("ルーティング有効時の先読み", () => {
  test("全部カバレッジ内ならフェッチせず成功を返す", async () => {
    env.OSM_SELF_HOSTED_ENDPOINT = SELF;
    // bbox を完全に含む
    env.OSM_SELF_HOSTED_COVERAGE = "0,0,50,180";

    const res = await post({ begin, end });

    expect(res.status).toBe(200);
    expect(requireOSMData).not.toHaveBeenCalled();
  });

  test("カバレッジ外なら先読みする", async () => {
    env.OSM_SELF_HOSTED_ENDPOINT = SELF;
    // 長岡を含まない
    env.OSM_SELF_HOSTED_COVERAGE = "0,0,10,10";

    const res = await post({ begin, end });

    expect(res.status).toBe(200);
    expect(requireOSMData).toHaveBeenCalled();
  });

  test("跨ぐセルは外部が担当するので先読みする", async () => {
    env.OSM_SELF_HOSTED_ENDPOINT = SELF;
    // bbox を緯度方向に跨ぐ境界 (37.44 は 1/64° の倍数ではない)
    env.OSM_SELF_HOSTED_COVERAGE = "0,0,37.44,180";

    const res = await post({ begin, end });

    expect(res.status).toBe(200);
    // 跨ぐセルと外のセルが先読み対象になる
    expect(requireOSMData).toHaveBeenCalled();
  });

  test("ルーティングが無効なら現行どおり全部先読みする", async () => {
    // OSM_SELF_HOSTED_ENDPOINT 未設定
    const res = await post({ begin, end });

    expect(res.status).toBe(200);
    expect(requireOSMData).toHaveBeenCalledTimes(1);
    expect(requireOSMData.mock.calls[0][1]).toEqual(getBoundaryBox(begin, end));
  });
});