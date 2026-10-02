import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { mergeOSMData } from "../../src/routes/api/osm/osm-data";
import { divideBoundary, type Boundary } from "../../src/routes/api/osm/boundary";
import { clone } from "./harness";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * フィクスチャの置き場所は環境変数で差し替えられる。
 *
 * CI で `actions/cache` から復元した OSM キャッシュ（`readCache` が読める
 * `{minLat}-{minLng}-{maxLat}-{maxLng}.json` 形式）を指定すれば、
 * git にデータを持たせずに済む。
 */
const FIXTURE_PATH =
  process.env.BENCH_FIXTURE ?? join(HERE, "..", "fixtures", "nagaoka-central.json.gz");

export type FixtureMeta = {
  name: string;
  description: string;
  source: string;
  capturedAt: string;
  cellCount: number;
  nodeCount: number;
  wayCount: number;
  bbox: { minLat: number; minLng: number; maxLat: number; maxLng: number };
};

/** セルファイル名 -> そのセルの OSMData */
export type Fixture = {
  meta: FixtureMeta;
  cells: Record<string, App.OSMData>;
};

let cached: Fixture | undefined;

export function loadFixtureArchive(): Fixture {
  if (cached !== undefined) return cached;
  const raw = gunzipSync(readFileSync(FIXTURE_PATH));
  const parsed = JSON.parse(raw.toString("utf-8")) as Fixture;
  if (parsed.meta === undefined || parsed.cells === undefined) {
    throw new Error(`フィクスチャの形式が不正です: ${FIXTURE_PATH}`);
  }
  cached = parsed;
  return parsed;
}

export function readFixtureMeta(): FixtureMeta {
  return loadFixtureArchive().meta;
}

/** `readCache` が読めるファイル名（昇順） */
export function listFixtureCells(): string[] {
  return Object.keys(loadFixtureArchive().cells).sort();
}

export function readFixtureCell(fileName: string): App.OSMData {
  const cell = loadFixtureArchive().cells[fileName];
  if (cell === undefined) throw new Error(`フィクスチャにセルがありません: ${fileName}`);
  return cell;
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
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const file of listFixtureCells()) {
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
