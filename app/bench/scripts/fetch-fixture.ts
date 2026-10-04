/**
 * bench のフィクスチャを `OSM_CACHE_DIR` に用意する。
 *
 * 本番の OSM キャッシュと同じセルファイル（`{minLat}-{minLng}-{maxLat}-{maxLng}.json`）を
 * 書き出す。`requireOSMData` を通すので、セルの分解・問い合わせ・保存はすべて
 * 本番と同じ経路で行われ、bench 側は `readCache` でそのまま読める。
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

import { requireOSMData } from "../../src/routes/api/osm/index";
import { cacheManager } from "../../src/routes/api/osm/fs-cache-manager";
import { fetchOverpassData } from "../../src/routes/api/osm/osm-fetcher";
import { divideBoundary, type Boundary } from "../../src/routes/api/osm/boundary";
import { RequestContext } from "../../src/lib/tracing/requestContext";
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

/** `OSM_CACHE_DIR` を読む */
function cacheDir(): string {
  const dir = process.env.OSM_CACHE_DIR;
  if (dir === undefined || dir === "") {
    throw new Error("OSM_CACHE_DIR 環境変数が設定されていません");
  }
  return dir;
}

/** `meta.json` と全セルが揃っているか */
function isComplete(): boolean {
  if (!existsSync(join(cacheDir(), "meta.json"))) return false;
  const expected = divideBoundary(BOUNDARY).map(
    (cell) => `${cell.minLat}-${cell.minLng}-${cell.maxLat}-${cell.maxLng}.json`,
  );
  const present = new Set(listFixtureCells());
  return expected.every((name) => present.has(name));
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
  if (isComplete()) {
    const meta = readFixtureMeta();
    console.log(
      `フィクスチャは揃っています: ${cacheDir()} (${meta.cellCount} cells, ` +
        `nodes=${meta.nodeCount}, ways=${meta.wayCount}, capturedAt=${meta.capturedAt})`,
    );
    return;
  }

  process.env.OVERPASS_ENDPOINT ??= DEFAULT_OVERPASS_ENDPOINT;
  console.log(`フィクスチャを取得します: ${cacheDir()}`);
  console.log(`  Overpass: ${process.env.OVERPASS_ENDPOINT}`);
  console.log(`  領域: ${JSON.stringify(BOUNDARY)}`);
  const started = Date.now();
  // requireOSMData はセルごとに readCache するので、欠けたセルだけを取り直す
  await requireOSMData(new RequestContext(), BOUNDARY, cacheManager, fetchOverpassData);
  const meta = writeMeta();
  console.log(
    `取得しました: ${meta.cellCount} cells, nodes=${meta.nodeCount}, ways=${meta.wayCount} ` +
      `(${(Date.now() - started) / 1000} 秒)`,
  );
}

await main();