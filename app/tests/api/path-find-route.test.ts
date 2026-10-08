import { expect, test, vi } from "vitest";
import { OSMCellLimitError } from "../../src/lib/osm";

const { doPathFind } = vi.hoisted(() => ({ doPathFind: vi.fn() }));

vi.mock("../../src/routes/api/path-find/pathFind", () => ({ doPathFind }));

import { POST } from "../../src/routes/api/path-find/+server";

/** POST ハンドラに渡す最小のリクエストを作る (overrides で項目を足す) */
function pathFindRequest(overrides: Record<string, unknown> = {}) {
  const request = {
    json: async () => ({
      begin: { lat: 37.44, lng: 138.85 },
      end: { lat: 37.45, lng: 138.87 },
      mode: "car",
      ...overrides,
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

const parametersWith = (lambda: number) => ({ lambda, mix_score_weight: 0.3, view_score_weight: 0.2, width_score_weight: 0.5 });

test("lambda が負なら 400 を返し、経路探索を呼ばない (#92)", async () => {
  doPathFind.mockClear();

  const res = await pathFindRequest({ parameters: parametersWith(-1) });

  expect(res.status).toBe(400);
  expect(doPathFind).not.toHaveBeenCalled();
});

test("lambda が 0 なら受け付けて、そのまま経路探索に渡す (#92)", async () => {
  doPathFind.mockClear();
  doPathFind.mockResolvedValueOnce({ found: false, reason: "NO_ROUTE", message: "経路が見つかりませんでした。" });

  const res = await pathFindRequest({ parameters: parametersWith(0) });

  expect(res.status).toBe(200);
  expect(doPathFind.mock.calls[0][3]).toMatchObject({ lambda: 0 });
});
