import { expect, test, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * 環境変数を差し替えてから tracing モジュールを読み込む。
 * `$env/dynamic/private` はランタイムに評価されるので、import 前に差し替える必要がある。
 */
let env: Record<string, string | undefined>;
let dir: string;

vi.mock("$env/dynamic/private", () => ({
  env: new Proxy({} as Record<string, string | undefined>, {
    get: (_t, key: string) => env[key],
  }),
}));

beforeEach(async () => {
  env = {};
  vi.resetModules();
  dir = await mkdtemp(join(tmpdir(), "tracing-"));
  env.DATABASE_LOCATOR = join(dir, "trace.db");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

test("saveRequest は requests と log_lines をまとめて保存する", async () => {
  const { saveRequest, getRequests } = await import("$lib/tracing/database.server");

  saveRequest(new Date(1000), "POST", "/api/path-find", { entries: [], start: 0, end: 1 }, [
    { loggedAt: 1001, log: "request: {}" },
    { loggedAt: 1002, log: "Error: boom" },
  ]);

  const requests = getRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0].logs).toEqual([
    { loggedAt: 1001, log: "request: {}" },
    { loggedAt: 1002, log: "Error: boom" },
  ]);
});

test("log_lines が無いリクエストは空配列になる", async () => {
  const { saveRequest, getRequests } = await import("$lib/tracing/database.server");

  saveRequest(new Date(1000), "POST", "/api/path-find", { entries: [], start: 0, end: 1 });

  expect(getRequests()[0].logs).toEqual([]);
});

test("boot で絞っても log_lines が付く", async () => {
  const { saveRequest, getRequests, getBoots } = await import("$lib/tracing/database.server");

  saveRequest(new Date(1000), "POST", "/api/path-find", { entries: [], start: 0, end: 1 }, [
    { loggedAt: 1001, log: "boot filtered" },
  ]);

  const bootId = getBoots()[0].id;
  expect(getRequests(bootId)[0].logs).toEqual([{ loggedAt: 1001, log: "boot filtered" }]);
});

test("RequestContext は log と logError を endMeasurement で保存する", async () => {
  const { RequestContext } = await import("$lib/tracing/requestContext");
  const { getRequests } = await import("$lib/tracing/database.server");

  const ctx = new RequestContext();
  ctx.log("hello");
  ctx.logError(new Error("boom"));
  ctx.endMeasurement(new Date(1000), "POST", "/api/path-find");

  const lines = getRequests()[0].logs.map((line) => line.log);
  expect(lines).toContain("hello");
  expect(lines).toContain("Error: boom");
});

test("RequestContext は Error 以外を 1 行で保存する", async () => {
  const { RequestContext } = await import("$lib/tracing/requestContext");
  const { getRequests } = await import("$lib/tracing/database.server");

  const ctx = new RequestContext();
  ctx.logError("plain failure");
  ctx.endMeasurement(new Date(1000), "POST", "/api/path-find");

  expect(getRequests()[0].logs.map((line) => line.log)).toEqual(["plain failure"]);
});
