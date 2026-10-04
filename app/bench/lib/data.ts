import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { mergeOSMData } from "../../src/routes/api/osm/osm-data";
import { divideBoundary, type Boundary } from "../../src/routes/api/osm/boundary";
import { clone } from "./harness";

/**
 * フィクスチャは本番の OSM キャッシュと同じディレクトリを直接読む。
 *
 * `scripts/fetch-fixture.ts` が `OSM_CACHE_DIR` に書き込むので、セルファイル名も
 * `fs-cache-manager` の `{minLat}-{minLng}-{maxLat}-{maxLng}.json` と同じ形式になる。
 * `cache-read` シナリオはこのセルを実際に `readCache` する。
 */
function cacheDir(): string {
  const dir = process.env.OSM_CACHE_DIR;
  if (dir === undefined || dir === "") {
    throw new Error(
      "OSM_CACHE_DIR 環境変数が設定されていません（bench/scripts/fetch-fixture.ts で取得します）",
    );
  }
  return dir;
}

/** `fs-cache-manager` のセルファイル名。一時ファイルは対象にする */
const CELL_FILE_PATTERN = /^(-?\d+(?:\.\d+)?-){3}-?\d+(?:\.\d+)?\.json$/;

/** フィクスチャの規模。セルファイルから求める */
export type FixtureStats = {
  /** セルファイルの数 */
  cellCount: number;
  /** 全セルのノード数 */
  nodeCount: number;
  /** 全セルの way 数 */
  wayCount: number;
  /** セルが覆う領域 */
  boundary: Boundary;
  /** 最も新しいセルファイルの更新日時 */
  fetchedAt: string;
};

let cached: FixtureStats | undefined;

/** `readCache` が読めるセルファイル名（昇順） */
export function listFixtureCells(): string[] {
  return readdirSync(cacheDir())
    .filter((file) => CELL_FILE_PATTERN.test(file))
    .sort();
}

export function readFixtureCell(fileName: string): App.OSMData {
  const cell = JSON.parse(readFileSync(join(cacheDir(), fileName), "utf-8")) as App.OSMData;
  return cell;
}

/**
 * フィクスチャの規模をセルファイルから求める。
 *
 * セルファイル名に領域が書いてあるため、別途 manifest を置かずに済む。
 * セルが 1 つも無い状態で測ると `pathLength` が 0 になって測定が成立しないので、
 * ここでは先に落とす。
 */
export function readFixtureStats(): FixtureStats {
  if (cached !== undefined) return cached;
  const files = listFixtureCells();
  if (files.length === 0) {
    throw new Error(
      `${cacheDir()} にセルファイルがありません（先に node bench/.build/fetch-fixture.mjs を実行してください）`,
    );
  }
  let nodeCount = 0;
  let wayCount = 0;
  let newest = 0;
  for (const file of files) {
    for (const element of readFixtureCell(file).elements) {
      if (element.type === "node") nodeCount += 1;
      else if (element.type === "way") wayCount += 1;
    }
    newest = Math.max(newest, statSync(join(cacheDir(), file)).mtimeMs);
  }
  cached = {
    cellCount: files.length,
    nodeCount,
    wayCount,
    boundary: boundaryOf(files),
    fetchedAt: new Date(newest).toISOString(),
  };
  return cached;
}

/**
 * フィクスチャの全セルを 1 つの OSMData にまとめる。
 * セルはグリッド上で隣接しているため、way の重複は id で除かれる。
 */
export function loadFixture(): App.OSMData {
  const merged: App.OSMData = { elements: [] };
  for (const file of listFixtureCells()) {
    mergeOSMData(merged, readFixtureCell(file));
  }
  return merged;
}

/** フィクスチャが覆う領域をセル境界にスナップした形で求める */
export function fixtureBoundary(): Boundary {
  return boundaryOf(listFixtureCells());
}

/** セルファイル名の範囲から領域を求める */
function boundaryOf(files: string[]): Boundary {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const file of files) {
    const [cellMinLat, cellMinLng, cellMaxLat, cellMaxLng] = file
      .replace(".json", "")
      .split("-")
      .map(Number);
    minLat = Math.min(minLat, cellMinLat);
    minLng = Math.min(minLng, cellMinLng);
    maxLat = Math.max(maxLat, cellMaxLat);
    maxLng = Math.max(maxLng, cellMaxLng);
  }
  return { minLat, minLng, maxLat, maxLng };
}

export function fixtureCellCount(boundary: Boundary): number {
  return divideBoundary(boundary).length;
}

/**
 * 経路探索の始点・終点を求める。
 *
 * bbox の補間点を使うと道から離れ、`transientSplit` が「エッジの長さがゼロです」で
 * 警告を出し、`pathFind` が何もせずに終わる（= 時間を計測できていない）ため、
 * グラフの最大連結成分に属する実ノードから選ぶ。
 */
export function pickEndpointsOnMainComponent(
  nodes: { coordinate: App.Coordinate }[],
): { begin: App.Coordinate; end: App.Coordinate } {
  const lats = nodes.map((n) => n.coordinate.lat);
  const lngs = nodes.map((n) => n.coordinate.lng);
  const bbox = {
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
  };
  const nearestTo = (fx: number, fy: number): App.Coordinate => {
    const targetLat = bbox.minLat + (bbox.maxLat - bbox.minLat) * fx;
    const targetLng = bbox.minLng + (bbox.maxLng - bbox.minLng) * fy;
    let best = nodes[0].coordinate;
    let bestDistance = Infinity;
    for (const node of nodes) {
      const distance = Math.hypot(node.coordinate.lat - targetLat, node.coordinate.lng - targetLng);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = node.coordinate;
      }
    }
    return best;
  };
  return { begin: nearestTo(0.08, 0.12), end: nearestTo(0.92, 0.88) };
}

export { clone };