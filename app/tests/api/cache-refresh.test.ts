import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, utimes, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * 環境変数を差し替えてからエンドポイントを読み込む。
 * `$env/dynamic/private` はランタイムに評価されるので、import 前に差し替える必要がある。
 */
let mod: typeof import("../../src/routes/api/cache-refresh/+server");
let env: Record<string, string | undefined>;

vi.mock("$env/dynamic/private", () => ({
  env: new Proxy({} as Record<string, string | undefined>, {
    get: (_t, key: string) => env[key],
  }),
}));

beforeEach(async () => {
  env = {};
  vi.resetModules();
  mod = await import("../../src/routes/api/cache-refresh/+server");
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TOKEN = "s3cret-token";

/** RequestHandler を叩いてステータスと JSON を取り出す */
async function callPost(token?: string, withTokenHeader = true) {
  const headers = new Headers();
  if (withTokenHeader && token !== undefined) {
    headers.set("x-procon-cache-refresh", token);
  }
  const request = { headers } as unknown as globalThis.Request;
  const res = await mod.POST({ request } as never);
  return { status: res.status, body: await res.json() };
}


test("トークンが未設定なら全リクエストを拒否する (fail-closed)", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = undefined;
  const res = await callPost(TOKEN);
  expect(res.status).toBe(503);
  expect(res.body.error).toContain("PROCON_CACHE_REFRESH_TOKEN");
});

test("トークン未設定かつヘッダも無い場合も拒否する", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = undefined;
  const res = await callPost(undefined, false);
  expect(res.status).toBe(503);
});

test("トークンが空文字なら未設定扱いになり拒否する", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = "";
  const res = await callPost(TOKEN);
  expect(res.status).toBe(503);
});


test("トークンが一致しない場合は 401", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = TOKEN;
  const res = await callPost("wrong-token");
  expect(res.status).toBe(401);
});

test("トークンが空文字のヘッダなら 401", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = TOKEN;
  const res = await callPost("");
  expect(res.status).toBe(401);
});

test("ヘッダ自体が無い場合は 401", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = TOKEN;
  const res = await callPost(undefined, false);
  expect(res.status).toBe(401);
});

test("トークンが部分的に一致するだけでは通らない", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = TOKEN;
  expect((await callPost(TOKEN.slice(0, -1))).status).toBe(401);
  expect((await callPost(TOKEN + "x")).status).toBe(401);
});

test("トークンが一致すれば認証を通る", async () => {
  env.PROCON_CACHE_REFRESH_TOKEN = TOKEN;
  env.OSM_CACHE_DIR = "/nonexistent-dir-for-test";
  const res = await callPost(TOKEN);
  expect(res.status).not.toBe(401);
  expect(res.status).not.toBe(503);
});


test("副作用のある操作は POST のみ export する", () => {
  const exported = mod as unknown as Record<string, unknown>;
  expect(typeof exported.POST).toBe("function");
  expect(exported.GET).toBeUndefined();
  expect(exported.PUT).toBeUndefined();
  expect(exported.DELETE).toBeUndefined();
  expect(exported.PATCH).toBeUndefined();
});


test("更新に失敗したセルがあれば非 2xx を返す (systemd 上では失敗として見える)", async () => {
  vi.doMock("../../src/routes/api/osm/osm-fetcher", () => ({
    fetchOverpassData: vi.fn().mockRejectedValue(new Error("Overpass API エラー: 429")),
  }));
  vi.resetModules();
  const m = await import("../../src/routes/api/cache-refresh/+server");

  const dir = await mkdtemp(join(tmpdir(), "cache-refresh-"));
  const b = { minLat: 0, minLng: 0, maxLat: 1 / 64, maxLng: 1 / 64 };
  const name = `${b.minLat}-${b.minLng}-${b.maxLat}-${b.maxLng}.json`;
  await writeFile(
    join(dir, name),
    JSON.stringify({ elements: [{ type: "node", id: 1, lat: 0.0001, lon: 0.0001 }] }),
    "utf-8",
  );
  const old = new Date(Date.now() - 90 * 86_400_000);
  await utimes(join(dir, name), old, old);

  env.PROCON_CACHE_REFRESH_TOKEN = TOKEN;
  env.OSM_CACHE_DIR = dir;
  env.OSM_CACHE_TTL_DAYS = "30";

  const headers = new Headers({ "x-procon-cache-refresh": TOKEN });
  const res = await m.POST({ request: { headers } as unknown as globalThis.Request } as never);
  const body = await res.json();

  expect(res.status).toBeGreaterThanOrEqual(400);
  expect(body.failed).toBeGreaterThan(0);
  await rm(dir, { recursive: true, force: true });
});

test("更新対象が無ければ 2xx", async () => {
  vi.doMock("../../src/routes/api/osm/osm-fetcher", () => ({
    fetchOverpassData: vi.fn().mockResolvedValue({ elements: [] }),
  }));
  vi.resetModules();
  const m = await import("../../src/routes/api/cache-refresh/+server");

  const dir = await mkdtemp(join(tmpdir(), "cache-refresh-"));
  env.PROCON_CACHE_REFRESH_TOKEN = TOKEN;
  env.OSM_CACHE_DIR = dir;
  env.OSM_CACHE_TTL_DAYS = "30";

  const headers = new Headers({ "x-procon-cache-refresh": TOKEN });
  const res = await m.POST({ request: { headers } as unknown as globalThis.Request } as never);
  const body = await res.json();

  expect(res.status).toBe(200);
  expect(body).toMatchObject({ scanned: 0, expired: 0, refreshed: 0, failed: 0 });
  await rm(dir, { recursive: true, force: true });
});
