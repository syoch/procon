import { expect, test, beforeEach, afterEach, vi } from "vitest";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile, utimes } from "fs/promises";
import { basename, join } from "path";
import { tmpdir } from "os";
import type { Boundary } from "../../src/lib/osm/boundary";
import { divideBoundary } from "../../src/lib/osm/boundary";

/** OSM_CACHE_DIR を一時ディレクトリに向けてからキャッシュマネージャを読み込む */
let cacheDir: string;
let mod: typeof import("../../src/lib/osm/fs-cache-manager");

vi.mock("$env/dynamic/private", () => ({
  env: {
    get OSM_CACHE_DIR() {
      return process.env.TEST_OSM_CACHE_DIR;
    },
  },
}));

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "osm-cache-test-"));
  process.env.TEST_OSM_CACHE_DIR = cacheDir;
  vi.resetModules();
  mod = await import("../../src/lib/osm/fs-cache-manager");
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
  delete process.env.TEST_OSM_CACHE_DIR;
});

/** 1/64 度格子のセル */
const D = 1 / 64;
function cell(latIndex: number, lngIndex: number): Boundary {
  return {
    minLat: 37 + latIndex * D,
    minLng: 138 + lngIndex * D,
    maxLat: 37 + (latIndex + 1) * D,
    maxLng: 138 + (lngIndex + 1) * D,
  };
}

const SAMPLE: App.OSMData = {
  elements: [
    { type: "node", id: 1, lat: 37.001, lon: 138.001 },
    { type: "way", id: 10, nodes: [1], tags: { highway: "residential" } },
  ],
};


test("saveCache 後にキャッシュファイルが読み出せる", async () => {
  await mod.cacheManager.saveCache(cell(0, 0), SAMPLE);
  const read = await mod.cacheManager.readCache(cell(0, 0));
  expect(read).toEqual(SAMPLE);
});

test("saveCache は書き込み後に一時ファイルを残さない", async () => {
  await mod.cacheManager.saveCache(cell(0, 0), SAMPLE);
  const files = await readdir(cacheDir);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/\.json$/);
  expect(files.some((f) => f.includes("-tmp."))).toBe(false);
});

test("saveCache は空データも保存する (その領域に道が無いのは正当な状態)", async () => {
  await mod.cacheManager.saveCache(cell(0, 0), { elements: [] });
  const files = await readdir(cacheDir);
  expect(files).toHaveLength(1);
  // ヒットになるので、このセルは検索のたびに Overpass を問い合わせない
  expect(await mod.cacheManager.readCache(cell(0, 0))).toEqual({ elements: [] });
});

test("saveCache はキャッシュディレクトリが無ければ作る", async () => {
  const nested = join(cacheDir, "deep", "path");
  process.env.TEST_OSM_CACHE_DIR = nested;
  vi.resetModules();
  const m = await import("../../src/lib/osm/fs-cache-manager");
  await m.cacheManager.saveCache(cell(0, 0), SAMPLE);
  expect(await m.cacheManager.readCache(cell(0, 0))).toEqual(SAMPLE);
});


test("readCache は空データもキャッシュヒットとして返す", async () => {
  // 空をヒットにしないと、道路のない領域は検索のたびに Overpass を問い合わせることになる
  const bound = cell(0, 0);
  const name = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
  await writeFile(join(cacheDir, name), JSON.stringify({ elements: [] }), "utf-8");

  expect(await mod.cacheManager.readCache(bound)).toEqual({ elements: [] });
});

// Windows では同一セルへの並行 saveCache が rename で EPERM になる。
// 本番は Linux で再現しないため、実装は変えず Windows だけ除外する。
// EPERM リトライは #128 で検討する。
test.runIf(process.platform !== "win32")("saveCache を並行実行しても一時ファイルが残らない (atomic)", async () => {
  const bounds = Array.from({ length: 20 }, (_, k) => cell(k, 0));
  await Promise.all(bounds.flatMap((b) => [mod.cacheManager.saveCache(b, SAMPLE), mod.cacheManager.saveCache(b, SAMPLE)]));

  const files = await readdir(cacheDir);
  expect(files.filter((f) => f.includes("-tmp."))).toHaveLength(0);
  expect(files).toHaveLength(bounds.length);
  for (const b of bounds) {
    expect(await mod.cacheManager.readCache(b)).toEqual(SAMPLE);
  }
});

// Windows では chmod による書き込み禁止が効かず saveCache が成功する。
// root と同じく、その環境では失敗を作れないので除外する。
test.runIf(process.getuid?.() !== 0 && process.platform !== "win32")(
  "書き込みに失敗しても一時ファイルを残さない",
  async () => {
    // ディレクトリは存在するが書き込めない状態にすることで、
    // writeFile が失敗する状況を作る (mkdir は成功している必要がある)
    const readOnly = join(cacheDir, "ro");
    await mkdir(readOnly, { recursive: true });
    await chmod(readOnly, 0o500);
    process.env.TEST_OSM_CACHE_DIR = readOnly;
    vi.resetModules();
    const m = await import("../../src/lib/osm/fs-cache-manager");

    await expect(m.cacheManager.saveCache(cell(0, 0), SAMPLE)).rejects.toThrow();

    const files = await readdir(readOnly);
    expect(files.filter((f) => f.includes("-tmp."))).toHaveLength(0);
    await chmod(readOnly, 0o700);
  },
);

test("readCache は未キャッシュなら null", async () => {
  expect(await mod.cacheManager.readCache(cell(3, 3))).toBeNull();
});

test("readCache は壊れた JSON を例外にせず miss として扱う (自己修復)", async () => {
  const bound = cell(0, 0);
  const name = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
  await writeFile(join(cacheDir, name), "{ 壊れた JSON", "utf-8");

  expect(await mod.cacheManager.readCache(bound)).toBeNull();
});


test("listCachedOSMCells: 正座標・負座標とも正しく復元する", async () => {
  const nagaoka = cell(0, 0);
  const newYork: Boundary = {
    minLat: 40.6,
    minLng: -73.9,
    maxLat: 40.7,
    maxLng: -73.8,
  };
  await mod.cacheManager.saveCache(nagaoka, SAMPLE);
  await mod.cacheManager.saveCache(newYork, SAMPLE);

  const cells = await mod.listCachedOSMCells();
  const keys = cells.map((c) => JSON.stringify(c.bound)).sort();
  expect(keys).toContain(JSON.stringify(nagaoka));
  expect(keys).toContain(JSON.stringify(newYork));
  expect(cells).toHaveLength(2);
});

test("listCachedOSMCells: 一時ファイルと未知のファイルは除外する", async () => {
  const bound = cell(0, 0);
  await mod.cacheManager.saveCache(bound, SAMPLE);
  const base = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}`;
  // 書き込み途中で残った一時ファイルと、未知の形式のファイル
  await writeFile(join(cacheDir, `${base}-tmp.1234.0.json`), "{}", "utf-8");
  await writeFile(join(cacheDir, "not-a-cache-file.txt"), "x", "utf-8");
  await writeFile(join(cacheDir, "1-2-3.json"), "{}", "utf-8");

  const cells = await mod.listCachedOSMCells();
  expect(cells).toHaveLength(1);
  expect(cells[0].bound).toEqual(bound);
});

test("listCachedOSMCells: mtime を返す", async () => {
  const bound = cell(0, 0);
  await mod.cacheManager.saveCache(bound, SAMPLE);

  const name = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
  const fixed = new Date("2020-01-02T03:04:05Z");
  await utimes(join(cacheDir, name), fixed, fixed);

  const cells = await mod.listCachedOSMCells();
  expect(cells).toHaveLength(1);
  expect(cells[0].fetchedAt).toBe(fixed.getTime());
});

test("listCachedOSMCells: ディレクトリが無ければ空配列", async () => {
  const missing = join(cacheDir, "not-created-yet");
  process.env.TEST_OSM_CACHE_DIR = missing;
  vi.resetModules();
  const m = await import("../../src/lib/osm/fs-cache-manager");
  expect(await m.listCachedOSMCells()).toEqual([]);
});

test("listCachedOSMCells: divideBoundary で作ったセルがそのまま復元できる", async () => {
  const cells = divideBoundary({
    minLat: 37,
    minLng: 138,
    maxLat: 37 + 3 * D,
    maxLng: 138 + 2 * D,
  });
  for (const b of cells) await mod.cacheManager.saveCache(b, SAMPLE);

  const listed = await mod.listCachedOSMCells();
  expect(listed).toHaveLength(cells.length);
  const listedKeys = new Set(listed.map((c) => JSON.stringify(c.bound)));
  for (const b of cells) {
    expect(listedKeys.has(JSON.stringify(b))).toBe(true);
  }
});

test("保存した JSON の内容は osm-data の要素をそのまま保持する", async () => {
  const bound = cell(0, 0);
  await mod.cacheManager.saveCache(bound, SAMPLE);
  const name = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
  const raw = JSON.parse(await readFile(join(cacheDir, name), "utf-8"));
  expect(raw).toEqual(SAMPLE);
});

test("mkdir 済みでも saveCache が失敗しない (existsSync 分岐)", async () => {
  await mkdir(cacheDir, { recursive: true });
  await mod.cacheManager.saveCache(cell(0, 0), SAMPLE);
  await mod.cacheManager.saveCache(cell(1, 1), SAMPLE);
  expect((await readdir(cacheDir)).length).toBe(2);
});


test("readCache は形が違うデータを例外にせず miss として扱う", async () => {
  const bound = cell(0, 0);
  const name = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
  const broken: unknown[] = [null, 123, "str", [], {}, { elements: null }, { elements: 123 }, { elements: {} }];

  for (const data of broken) {
    await writeFile(join(cacheDir, name), JSON.stringify(data), "utf-8");
    expect(await mod.cacheManager.readCache(bound)).toBeNull();
  }
});

test("cleanupStaleTempFiles は古い一時ファイルを削除し、新しいものは残す", async () => {
  const base = `${cell(0, 0).minLat}-${cell(0, 0).minLng}-${cell(0, 0).maxLat}-${cell(0, 0).maxLng}`;
  const oldTmp = join(cacheDir, `${base}-tmp.111.0.json`);
  const newTmp = join(cacheDir, `${base}-tmp.222.0.json`);
  const final = join(cacheDir, `${base}.json`);

  await writeFile(oldTmp, "{}", "utf-8");
  await writeFile(newTmp, "{}", "utf-8");
  await mod.cacheManager.saveCache(cell(0, 0), SAMPLE);

  const old = new Date(Date.now() - 7200_000);
  await utimes(oldTmp, old, old);

  const removed = await mod.cleanupStaleTempFiles();
  expect(removed).toBe(1);

  const left = await readdir(cacheDir);
  expect(left).toContain(`${base}-tmp.222.0.json`); // 新しい方は残す
  expect(left).not.toContain(`${base}-tmp.111.0.json`); // 古い方は削除
  expect(left).toContain(basename(final)); // 本番ファイルは残る
  expect(await mod.cacheManager.readCache(cell(0, 0))).toEqual(SAMPLE);
});

test("cleanupStaleTempFiles はディレクトリが無ければ 0", async () => {
  process.env.TEST_OSM_CACHE_DIR = join(cacheDir, "not-created");
  vi.resetModules();
  const m = await import("../../src/lib/osm/fs-cache-manager");
  expect(await m.cleanupStaleTempFiles()).toBe(0);
});


test("readCache は要素の形が壊れたデータをヒットにしない (Overpass を呼ばず 500 になるのを防ぐ)", async () => {
  const bound = cell(0, 0);
  const name = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const broken = [
    { elements: [{ type: "way", id: 1 }] },              // nodes が無い
    { elements: [{ type: "node", id: 1 }] },             // lat / lon が無い
    { elements: [null] },
    { elements: [{ type: "node", id: 1, lat: "x", lon: 1 }] },
  ];
  for (const data of broken) {
    await writeFile(join(cacheDir, name), JSON.stringify(data), "utf-8");
    expect(await mod.cacheManager.readCache(bound)).toBeNull();
  }
  warn.mockRestore();
});

test("readCache は未知の要素種別を許容する (将来の Overpass 拡張に耐える)", async () => {
  const bound = cell(0, 0);
  const name = `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
  await writeFile(
    join(cacheDir, name),
    JSON.stringify({ elements: [{ type: "relation", id: 1 }, { type: "node", id: 2, lat: 0.001, lon: 0.001 }] }),
    "utf-8",
  );
  expect(await mod.cacheManager.readCache(bound)).not.toBeNull();
});

test("cleanupStaleTempFiles は saveCache が一時ファイル名で作る形に限って削除する", async () => {
  const old = new Date(Date.now() - 7200_000);
  const realTmp = join(cacheDir, "0-0-0.015625-0.015625-tmp.111.0.json");
  const unrelated = join(cacheDir, "my-important-tmp.backup.json");
  await writeFile(realTmp, "{}", "utf-8");
  await writeFile(unrelated, "{}", "utf-8");
  await utimes(realTmp, old, old);
  await utimes(unrelated, old, old);

  const removed = await mod.cleanupStaleTempFiles();
  expect(removed).toBe(1);

  const left = await readdir(cacheDir);
  expect(left).not.toContain("0-0-0.015625-0.015625-tmp.111.0.json");
  expect(left).toContain("my-important-tmp.backup.json");
});

test("復元できないファイルは警告する (無音で無視しない)", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await writeFile(join(cacheDir, "not-a-cache-file.txt"), "x", "utf-8");
  const cells = await mod.listCachedOSMCells();
  expect(cells).toHaveLength(0);
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});

