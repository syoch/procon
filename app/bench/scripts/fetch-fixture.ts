/**
 * bench のフィクスチャを `OSM_CACHE_DIR` に用意する。
 *
 * 本番の OSM キャッシュと同じセルファイル（`{minLat}-{minLng}-{maxLat}-{maxLng}.json`）を
 * `cacheManager.saveCache` で書き出すので、`cache-read` シナリオは `readCache` でそのまま読める。
 * 問い合わせは本番と同じ `fetchOverpassData` を通す。
 *
 * 1 セルずつ問い合わせる。まとめて 1 回で問い合わせると公開 Overpass 側で
 * タイムアウトするので（504 が返る）、セルの数だけ小さく分けて取る。
 * 取り直しはセルの数だけコストがかかるので、まず `readCache` で既にあるセルを飛ばす。
 *
 * `meta.json` と全セルが揃っていれば何もしない。
 * CI は `actions/cache` でこのディレクトリを復元するので、2 回目以降はネットワークに
 * 出ずに終わる。
 *
 * 使い方:
 *   node bench/build.mjs
 *   OSM_CACHE_DIR=/tmp/osm-cache node bench/.build/fetch-fixture.mjs
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { cacheManager } from "../../src/routes/api/osm/fs-cache-manager";
import { fetchOverpassData } from "../../src/routes/api/osm/osm-fetcher";
import { divideBoundary, type Boundary } from "../../src/routes/api/osm/boundary";
import { listFixtureCells, readFixtureCell, readFixtureMeta, type FixtureMeta } from "../lib/data";

/**
 * 取得する領域（長岡市中心部）。
 *
 * セル境界にスナップした値にして、`divideBoundary` が 8 セルちょうどになるようにしている。
 * フィクスチャの大きさが変わると全測定項目の絶対値も変わるので、
 * セル数と大きさを固定した値にして、変えた理由が分かるようにしている。
 */
const BOUNDARY: Boundary = {
  minLat: 37.421875,
  minLng: 138.84375,
  maxLat: 37.453125,
  maxLng: 138.90625,
};

/** 公開されている Overpass のエンドポイント。`OVERPASS_ENDPOINT` で差し替えられる */
const DEFAULT_OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/** 1 セルにつき試す回数 */
const MAX_ATTEMPTS = 3;

/** リトライの前に待つ時間 [ms] */
const RETRY_WAIT_MS = 5_000;

/** `OSM_CACHE_DIR` を読む */
function cacheDir(): string {
  const dir = process.env.OSM_CACHE_DIR;
  if (dir === undefined || dir === "") {
    throw new Error("OSM_CACHE_DIR 環境変数が設定されていません");
  }
  return dir;
}

/** `fs-cache-manager` のセルファイル名 */
function cellFileName(cell: Boundary): string {
  return `${cell.minLat}-${cell.minLng}-${cell.maxLat}-${cell.maxLng}.json`;
}

/** `meta.json` と全セルが揃っているか */
function isComplete(cells: Boundary[]): boolean {
  if (!existsSync(join(cacheDir(), "meta.json"))) return false;
  const present = new Set(listFixtureCells());
  return cells.every((cell) => present.has(cellFileName(cell)));
}

/**
 * 1 セルを Overpass から取得する。
 *
 * 公開 Overpass は混雑しているごとに 504 を返すので、一定時間置いてから試す。
 */
async function fetchCell(cell: Boundary): Promise<App.OSMData> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fetchOverpassData([cell]);
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `  ${cellFileName(cell)}: ${message} / ` +
          `${RETRY_WAIT_MS / 1000} 秒置いてから ${attempt + 1} 回目を試します`,
      );
      await sleep(RETRY_WAIT_MS);
    }
  }
}

function writeMeta(): FixtureMeta {
  let nodeCount = 0;
  let wayCount = 0;
  const cells = listFixtureCells();
  for (const cell of cells) {
    for (const element of readFixtureCell(cell).elements) {
      if (element.type === "node") nodeCount += 1;
      else if (element.type === "way") wayCount += 1;
    }
  }
  const meta: FixtureMeta = {
    name: "nagaoka-central",
    capturedAt: new Date().toISOString(),
    cellCount: cells.length,
    nodeCount,
    wayCount,
    bbox: BOUNDARY,
  };
  writeFileSync(join(cacheDir(), "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  return meta;
}

async function main(): Promise<void> {
  const cells = divideBoundary(BOUNDARY);
  if (isComplete(cells)) {
    const meta = readFixtureMeta();
    console.log(
      `フィクスチャは揃っています: ${cacheDir()} (${meta.cellCount} cells, ` +
        `nodes=${meta.nodeCount}, ways=${meta.wayCount}, capturedAt=${meta.capturedAt})`,
    );
    return;
  }

  process.env.OVERPASS_ENDPOINT ??= DEFAULT_OVERPASS_ENDPOINT;
  console.log(`フィクスチャを取得します: ${cacheDir()} (${cells.length} セル)`);
  console.log(`  Overpass: ${process.env.OVERPASS_ENDPOINT}`);
  console.log(`  領域: ${JSON.stringify(BOUNDARY)}`);
  const started = Date.now();
  for (const [index, cell] of cells.entries()) {
    const cached = await cacheManager.readCache(cell);
    if (cached === null) {
      await cacheManager.saveCache(cell, await fetchCell(cell));
    }
    console.log(`  ${index + 1}/${cells.length} ${cellFileName(cell)}`);
  }
  const meta = writeMeta();
  console.log(
    `取得しました: ${meta.cellCount} cells, nodes=${meta.nodeCount}, ways=${meta.wayCount} ` +
      `(${(Date.now() - started) / 1000} 秒)`,
  );
}

await main();