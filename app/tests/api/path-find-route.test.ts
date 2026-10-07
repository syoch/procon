import { expect, test, vi } from "vitest";
import { OSMCellLimitError } from "../../src/lib/osm";

const { doPathFind } = vi.hoisted(() => ({ doPathFind: vi.fn() }));

vi.mock("../../src/routes/api/path-find/pathFind", () => ({ doPathFind }));

import { POST } from "../../src/routes/api/path-find/+server";

/** POST ハンドラに渡す最小のリクエストを作る */
function pathFindRequest() {
  const request = {
    json: async () => ({
      begin: { lat: 37.44, lng: 138.85 },
      end: { lat: 37.45, lng: 138.87 },
      mode: "car",
    }),
    url: "http://localhost/api/path-find",
  } as unknown as globalThis.Request;
  return POST({ request } as never);
}

test("セル上限超過は 422 と利用者向けメッセージを返す (#117)", async () => {
  doPathFind.mockRejectedValueOnce(new OSMCellLimitError(529, 512));

  const res = await pathFindRequest();

  expect(res.status).toBe(422);
  const body = await res.json();
  expect(body.found).toBe(false);
  expect(body.message).toContain("529");
  expect(body.message).toContain("512");
  expect(body.message).toContain("始点と終点を近づけてください");
});
