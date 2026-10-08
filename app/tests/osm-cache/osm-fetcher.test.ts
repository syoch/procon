import { expect, test, vi, beforeEach } from "vitest";
import type { Boundary } from "../../src/lib/osm/boundary";
import { fetchOverpassData } from "../../src/lib/osm/osm-fetcher";

// endpoint は引数で渡す。env は読まない
const ENDPOINT = "https://overpass.example.test/api";

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
  vi.unstubAllGlobals();
});

test("与えられた endpoint へ投げて、正常な応答をそのまま返す", async () => {
  const data = { elements: [{ type: "node", id: 1, lat: 37.45, lon: 138.86 }] };
  const spy = mockFetch(200, data);

  expect(await fetchOverpassData(ENDPOINT, [B])).toEqual(data);
  expect(spy.mock.calls[0][0]).toBe(ENDPOINT);
});

test("remark があれば失敗として扱う (要素が無くても)", async () => {
  // 実測: timeout:1 で way だけ入った応答 + remark が返る
  const spy = mockFetch(200, {
    elements: [],
    remark: 'runtime error: Query timed out in "query" at line 2 after 4 seconds.',
  });

  await expect(fetchOverpassData(ENDPOINT, [B])).rejects.toThrow(/Query timed out/);
  expect(spy).toHaveBeenCalledTimes(1);
});

test("remark があっても要素が入っていれば失敗として扱う (欠けたデータを返さない)", async () => {
  // 実測: ways=7008 / nodes=0 + remark。保存されると TTL の間不完全な地図が使われ続ける
  mockFetch(200, {
    elements: [{ type: "way", id: 1, nodes: [2], tags: { highway: "residential" } }],
    remark: 'runtime error: Query timed out in "print" at line 5 after 3 seconds.',
  });

  await expect(fetchOverpassData(ENDPOINT, [B])).rejects.toThrow(/Query timed out/);
});

test("remark が空文字なら失敗として扱う", async () => {
  mockFetch(200, { elements: [], remark: "" });

  await expect(fetchOverpassData(ENDPOINT, [B])).rejects.toThrow(/Overpass API エラー/);
});

test("remark が無ければ空要素も正常な応答として返す", async () => {
  // 陸地だが道路が無い領域なので、これは正常な応答
  const data = { elements: [] };
  mockFetch(200, data);

  expect(await fetchOverpassData(ENDPOINT, [B])).toEqual(data);
});

test("HTTP エラーは失敗として扱う", async () => {
  mockFetch(504, "<html>gateway timeout</html>");

  await expect(fetchOverpassData(ENDPOINT, [B])).rejects.toThrow(/504/);
});