import { expect, test, vi, beforeEach } from "vitest";
import type { Boundary } from "../../src/routes/api/osm/boundary";

vi.mock("$env/dynamic/private", () => ({
  env: { OVERPASS_ENDPOINT: "https://overpass.example.test/api" },
}));

const B: Boundary = { minLat: 37.44, minLng: 138.85, maxLat: 37.46, maxLng: 138.87 };

/** Overpass の応答を模した fetch。status と body を指定する */
function mockFetch(status: number, body: unknown) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "Mocked",
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => {
  vi.resetModules();
});

test("正常な応答はそのまま返す", async () => {
  const data = { elements: [{ type: "node", id: 1, lat: 37.45, lon: 138.86 }] };
  mockFetch(200, data);
  const { fetchOverpassData } = await import("../../src/routes/api/osm/osm-fetcher");

  expect(await fetchOverpassData([B])).toEqual(data);
  vi.unstubAllGlobals();
});

test("remark があれば失敗として扱う (要素が無くても)", async () => {
  // 実測: timeout:1 で way だけ入った応答 + remark が返る
  const spy = mockFetch(200, {
    elements: [],
    remark: 'runtime error: Query timed out in "query" at line 2 after 4 seconds.',
  });
  const { fetchOverpassData } = await import("../../src/routes/api/osm/osm-fetcher");

  await expect(fetchOverpassData([B])).rejects.toThrow(/Query timed out/);
  expect(spy).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test("remark があっても要素が入っていれば失敗として扱う (欠けたデータを返さない)", async () => {
  // 実測: ways=7008 / nodes=0 + remark。保存されると TTL の間不完全な地図が使われ続ける
  mockFetch(200, {
    elements: [{ type: "way", id: 1, nodes: [2], tags: { highway: "residential" } }],
    remark: 'runtime error: Query timed out in "print" at line 5 after 3 seconds.',
  });
  const { fetchOverpassData } = await import("../../src/routes/api/osm/osm-fetcher");

  await expect(fetchOverpassData([B])).rejects.toThrow(/Query timed out/);
  vi.unstubAllGlobals();
});

test("remark が空文字なら失敗として扱う", async () => {
  mockFetch(200, { elements: [], remark: "" });
  const { fetchOverpassData } = await import("../../src/routes/api/osm/osm-fetcher");

  await expect(fetchOverpassData([B])).rejects.toThrow(/Overpass API エラー/);
  vi.unstubAllGlobals();
});

test("remark が無ければ空要素も正常な応答として返す", async () => {
  // 陸地だが道路が無い領域なので、これは正常な応答
  const data = { elements: [] };
  mockFetch(200, data);
  const { fetchOverpassData } = await import("../../src/routes/api/osm/osm-fetcher");

  expect(await fetchOverpassData([B])).toEqual(data);
  vi.unstubAllGlobals();
});

test("HTTP エラーは従来どおり失敗として扱う", async () => {
  mockFetch(504, "<html>gateway timeout</html>");
  const { fetchOverpassData } = await import("../../src/routes/api/osm/osm-fetcher");

  await expect(fetchOverpassData([B])).rejects.toThrow(/504/);
  vi.unstubAllGlobals();
});
