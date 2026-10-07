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

test("insertRequest と insertLogLine は requests と log_lines を保存する", async () => {
  const { insertRequest, insertLogLine, finishRequest, getRequests } = await import("$lib/tracing/database.server");

  const id = insertRequest(new Date(1000), "POST", "/api/path-find", 0);
  expect(id).toBeTypeOf("string");
  insertLogLine(id as string, "request: begin");
  finishRequest(id as string, { entries: [], start: 0, end: 5 });

  const requests = getRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0].logs.map((line) => line.log)).toEqual(["request: begin"]);
  expect(requests[0].perf).toEqual({ entries: [], start: 0, end: 5 });
});

test("log_lines が無いリクエストは空配列になる", async () => {
  const { insertRequest, getRequests } = await import("$lib/tracing/database.server");

  insertRequest(new Date(1000), "POST", "/api/path-find", 0);

  expect(getRequests()[0].logs).toEqual([]);
});

test("log_lines の索引が作られる", async () => {
  const { insertRequest } = await import("$lib/tracing/database.server");
  const { DatabaseSync } = await import("node:sqlite");

  insertRequest(new Date(1000), "POST", "/api/path-find", 0);

  const database = new DatabaseSync(join(dir, "trace.db"));
  const names = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'log_lines'")
    .all()
    .map((row) => String(row.name));
  database.close();

  expect(names).toContain("idx_log_lines_request_id");
  expect(names).toContain("idx_log_lines_logged_at");
});

test("boot で絞っても log_lines が付く", async () => {
  const { insertRequest, insertLogLine, getRequests, getBoots } = await import("$lib/tracing/database.server");

  const id = insertRequest(new Date(1000), "POST", "/api/path-find", 0) as string;
  insertLogLine(id, "boot filtered");

  const bootId = getBoots()[0].id;
  expect(getRequests(bootId)[0].logs.map((line) => line.log)).toEqual(["boot filtered"]);
});

test("RequestContext は log を endMeasurement の前に保存する", async () => {
  const { RequestContext } = await import("$lib/tracing/requestContext");
  const { getRequests } = await import("$lib/tracing/database.server");

  const ctx = new RequestContext(new Date(1000), "POST", "/api/path-find");
  ctx.log("before finish");

  const requests = getRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0].logs.map((line) => line.log)).toEqual(["before finish"]);
});

test("RequestContext は log と logError を保存し endMeasurement で performance を書く", async () => {
  const { RequestContext } = await import("$lib/tracing/requestContext");
  const { getRequests } = await import("$lib/tracing/database.server");

  const ctx = new RequestContext(new Date(1000), "POST", "/api/path-find");
  ctx.measure("span", () => 0);
  ctx.log("hello");
  ctx.logError(new Error("boom"));
  ctx.endMeasurement();

  const request = getRequests()[0];
  const lines = request.logs.map((line) => line.log);
  expect(lines).toContain("hello");
  expect(lines).toContain("Error: boom");
  expect(request.perf.entries.map((entry) => entry.name)).toEqual(["span"]);
});

test("RequestContext は Error 以外を 1 行で保存する", async () => {
  const { RequestContext } = await import("$lib/tracing/requestContext");
  const { getRequests } = await import("$lib/tracing/database.server");

  const ctx = new RequestContext(new Date(1000), "POST", "/api/path-find");
  ctx.logError("plain failure");
  ctx.endMeasurement();

  expect(getRequests()[0].logs.map((line) => line.log)).toEqual(["plain failure"]);
});
