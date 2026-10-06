/**
 * フィクスチャを `OSM_CACHE_DIR` に用意する。
 *
 * 取得は本番と同じ `requireOSMData` を通すので、セルへの分割・問い合わせ・保存は
 * 本番と同じ経路になる。1 クエリが 504 を返すときは全体を取り直す。
 * 全セルが揃っていれば何もしない。
 *
 * @ref README.md#フィクスチャ
 */
import { setTimeout as sleep } from "node:timers/promises";

import { requireOSMData } from "../../src/lib/osm/index";
import { cacheManager } from "../../src/lib/osm/fs-cache-manager";
import { fetchOverpassData } from "../../src/lib/osm/osm-fetcher";
import { divideBoundary, type Boundary } from "../../src/lib/osm/boundary";
import { RequestContext } from "../../src/lib/tracing/requestContext";
import { readFixtureStats } from "../lib/data";

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

/** 取得に失敗したときに取り直す回数 */
const MAX_ATTEMPTS = 3;

/** 取り直す前に待つ時間 [ms] */
const RETRY_WAIT_MS = 5_000;

/** `OSM_CACHE_DIR` を読む */
function cacheDir(): string {
  const dir = process.env.OSM_CACHE_DIR;
  if (dir === undefined || dir === "") {
    throw new Error("OSM_CACHE_DIR 環境変数が設定されていません");
  }
  return dir;
}

/** キャッシュに無いセルを列挙する */
async function missingCells(cells: Boundary[]): Promise<Boundary[]> {
  const missing: Boundary[] = [];
  for (const cell of cells) {
    if ((await cacheManager.readCache(cell)) === null) missing.push(cell);
  }
  return missing;
}

/**
 * 全セルを取得する。
 *
 * 取得は `requireOSMData` に任せるので、1 クエリにまとめる判断は本番と共有する。
 * 失敗したときだけ取り直し、キャッシュに残ったセルは次の取り直しで `readCache` が飛ばす。
 */
async function fetchFixture(cells: Boundary[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await requireOSMData(new RequestContext(), BOUNDARY, cacheManager, fetchOverpassData);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const missing = await missingCells(cells);
      if (attempt >= MAX_ATTEMPTS || missing.length === 0) throw error;
      console.log(
        `  ${message} / 残り ${missing.length} セル / ` +
          `${RETRY_WAIT_MS / 1000} 秒置いてから取り直します（${attempt} 回目）`,
      );
      await sleep(RETRY_WAIT_MS);
    }
  }
}

async function main(): Promise<void> {
  const cells = divideBoundary(BOUNDARY);
  const missing = await missingCells(cells);
  if (missing.length === 0) {
    const stats = readFixtureStats();
    console.log(
      `フィクスチャは揃っています: ${cacheDir()} (${stats.cellCount} cells, ` +
        `nodes=${stats.nodeCount}, ways=${stats.wayCount}, fetchedAt=${stats.fetchedAt})`,
    );
    return;
  }

  process.env.OVERPASS_ENDPOINT ??= DEFAULT_OVERPASS_ENDPOINT;
  console.log(
    `フィクスチャを取得します: ${cacheDir()} (${cells.length} セル、うち ${missing.length} セルが未取得)`,
  );
  console.log(`  Overpass: ${process.env.OVERPASS_ENDPOINT}`);
  console.log(`  領域: ${JSON.stringify(BOUNDARY)}`);
  const started = Date.now();
  await fetchFixture(cells);
  const stats = readFixtureStats();
  console.log(
    `取得しました: ${stats.cellCount} cells, nodes=${stats.nodeCount}, ways=${stats.wayCount} ` +
      `(${(Date.now() - started) / 1000} 秒)`,
  );
}

await main();