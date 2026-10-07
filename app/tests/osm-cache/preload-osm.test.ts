import { beforeEach, expect, test, vi } from "vitest";
import { getBoundaryBox } from "../../src/lib/osm/path-boundary";

const { requireOSMData } = vi.hoisted(() => ({
  requireOSMData: vi.fn(async (_reqCtx: unknown, _bbox: unknown) => ({ elements: [] })),
}));

vi.mock("../../src/lib/osm", () => ({ requireOSMData }));
vi.mock("../../src/lib/osm/fs-cache-manager", () => ({ cacheManager: {} }));
vi.mock("../../src/lib/osm/osm-fetcher", () => ({ fetchOverpassData: vi.fn() }));

import { POST } from "../../src/routes/api/preload-osm/+server";

beforeEach(() => {
  requireOSMData.mockClear();
});

function post(body: unknown) {
  const request = { json: async () => body } as unknown as globalThis.Request;
  return POST({ request } as never);
}

test("両端点からは経路探索と同じ範囲を温める", async () => {
  const begin = { lat: 37.448, lng: 138.853 };
  const end = { lat: 37.441, lng: 138.868 };

  const res = await post({ begin, end });

  expect(res.status).toBe(200);
  expect(requireOSMData.mock.calls[0][1]).toEqual(getBoundaryBox(begin, end));
});

test("片端点だけならその周辺を温める", async () => {
  const begin = { lat: 37.448, lng: 138.853 };

  const res = await post({ begin });

  expect(res.status).toBe(200);
  expect(requireOSMData.mock.calls[0][1]).toEqual(getBoundaryBox(begin, begin));
});

test("端点が無ければ 400", async () => {
  const res = await post({});
  expect(res.status).toBe(400);
  expect(requireOSMData).not.toHaveBeenCalled();
});
