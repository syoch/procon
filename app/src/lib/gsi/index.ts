import type { Boundary } from "../osm/boundary";
import { parseGsiRoadTile, type GsiRoadSegment } from "./parse";

/** 国土地理院の道路中心線タイルのズームレベル (提供されているのは 16 のみ) */
export const GSI_TILE_ZOOM = 16;
/** 同時に取得するタイル数の上限 (国土地理院のサーバーに一度に大量のリクエストを送らないため) */
const MAX_CONCURRENT_FETCHES = 4;
/**
 * 1 回の探索で使うタイル数の上限。超える場合は幅員を使わずに探索する (仮の値)
 * 探索範囲 (getBoundaryBox) は 1/64° の格子単位なので、同じ地点どうしでも約 120 枚、市内 1km で約 200 枚、
 * 長岡駅〜見附駅 (約 10km) で約 700 枚になる。長岡〜見附程度までは幅員を使えるよう 1024 枚とした
 * (経路探索 (pathFind.ts) は探索範囲全体ではなく経路の周りのタイルだけを使うので、実際の枚数はこれよりずっと少ない。
 *  例: 長岡高専〜越後広瀬 (直線で約 19km) は探索範囲全体だと上限を超えて幅員なし (0%) だったが、
 *  経路の周りだけにすると幅員の網羅率 94.5〜99.3% (2026-10-01 実測))
 */
export const MAX_GSI_TILES = 1024;
/**
 * 経路の周りのタイルを選ぶときに、経路の上の点を取る間隔 [m]
 * タイル (ズーム 16) は長岡付近で 1 辺約 490m なので、それより十分短くして、経路が通るタイルを取りこぼさないようにする
 */
const PATH_SAMPLE_INTERVAL_M = 200;
/**
 * 1 回の探索でタイルの取得にかける時間の上限 [ms] (仮の値)
 * 超えたら残りのタイルは取得せず、幅員なしで探索を続ける (応答が返らない状態を防ぐため)
 */
export const GSI_FETCH_BUDGET_MS = 30_000;

export type GsiTile = { x: number; y: number };

/** タイル 1 枚を取得する (タイルが存在しない場合は null) */
export type GsiTileFetcher = (tile: GsiTile) => Promise<unknown | null>;

export type GsiFetchOptions = {
  /** タイル数の上限 (既定 MAX_GSI_TILES) */
  maxTiles?: number;
  /** 取得にかける時間の上限 [ms] (既定 GSI_FETCH_BUDGET_MS) */
  budgetMs?: number;
};

export type GsiCacheManager = {
  /** キャッシュ済みの区間 (未キャッシュなら null) */
  readCache: (tile: GsiTile) => Promise<GsiRoadSegment[] | null>;
  saveCache: (tile: GsiTile, segments: GsiRoadSegment[]) => Promise<void>;
};

/** 緯度経度 → タイル番号 (Web メルカトル) */
export function coordinateToTile(lat: number, lng: number, zoom = GSI_TILE_ZOOM): GsiTile {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n),
  };
}

/** タイルを Map / Set のキーにする */
export function tileKey(tile: GsiTile): string {
  return `${tile.x}/${tile.y}`;
}

/**
 * 経路 (座標の列) が通るタイルと、その周り bufferTiles 枚分のタイルの一覧
 * 座標が 1 つだけなら、その点の周りのタイルになる
 *
 * @param bufferTiles 周りに足すタイルの枚数 (1 なら 3×3 の範囲)
 */
export function tilesAlongPath(coords: readonly App.Coordinate[], bufferTiles = 1, zoom = GSI_TILE_ZOOM): GsiTile[] {
  const tiles = new Map<string, GsiTile>();
  const addAround = (c: App.Coordinate) => {
    const center = coordinateToTile(c.lat, c.lng, zoom);
    for (let dx = -bufferTiles; dx <= bufferTiles; dx++) {
      for (let dy = -bufferTiles; dy <= bufferTiles; dy++) {
        const tile = { x: center.x + dx, y: center.y + dy };
        tiles.set(tileKey(tile), tile);
      }
    }
  };
  if (coords.length > 0) addAround(coords[0]);
  for (let i = 0; i < coords.length - 1; i++) {
    // 長い区間 (直線の道など) の途中のタイルも取りこぼさないよう、一定間隔で点を取る
    const a = coords[i], b = coords[i + 1];
    const steps = Math.max(1, Math.ceil(approxDistanceM(a, b) / PATH_SAMPLE_INTERVAL_M));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      addAround({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
    }
  }
  return [...tiles.values()];
}

/** 2 点間のおおよその距離 [m] (近い 2 点の間引き用なので正距円筒の近似で十分) */
function approxDistanceM(a: App.Coordinate, b: App.Coordinate): number {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dx = (b.lng - a.lng) * 111320 * Math.cos(meanLat);
  const dy = (b.lat - a.lat) * 110574;
  return Math.hypot(dx, dy);
}

/** 範囲を覆うタイルの一覧 */
export function tilesForBoundary(boundary: Boundary, zoom = GSI_TILE_ZOOM): GsiTile[] {
  // タイルの y は北ほど小さい
  const northWest = coordinateToTile(boundary.maxLat, boundary.minLng, zoom);
  const southEast = coordinateToTile(boundary.minLat, boundary.maxLng, zoom);
  const tiles: GsiTile[] = [];
  for (let x = northWest.x; x <= southEast.x; x++) {
    for (let y = northWest.y; y <= southEast.y; y++) {
      tiles.push({ x, y });
    }
  }
  return tiles;
}

/**
 * 範囲内の国土地理院の道路中心線 (幅員の分かる車道の区間) を取得する (範囲を覆うタイルで requireGsiRoadSegmentsForTiles を呼ぶ)
 */
export async function requireGsiRoadSegments(
  boundary: Boundary,
  cacheManager: GsiCacheManager,
  fetchTile: GsiTileFetcher,
  options: GsiFetchOptions = {},
): Promise<GsiRoadSegment[]> {
  return requireGsiRoadSegmentsForTiles(tilesForBoundary(boundary), cacheManager, fetchTile, options);
}

/**
 * 指定したタイルの国土地理院の道路中心線 (幅員の分かる車道の区間) を取得する
 *
 * タイル単位でキャッシュし、未キャッシュのタイルだけを取得する。
 * 取得 (キャッシュの読み書きを含む) に失敗したタイルは空として扱い (キャッシュはしない)、
 * 経路探索自体は幅員なしで続けられるようにする。
 * タイル数が上限を超える場合は幅員なしで続ける。時間の上限を過ぎた後は、キャッシュ済みのタイルだけを使い、新しく取得はしない。
 */
export async function requireGsiRoadSegmentsForTiles(
  tiles: readonly GsiTile[],
  { readCache, saveCache }: GsiCacheManager,
  fetchTile: GsiTileFetcher,
  { maxTiles = MAX_GSI_TILES, budgetMs = GSI_FETCH_BUDGET_MS }: GsiFetchOptions = {},
): Promise<GsiRoadSegment[]> {
  const result: GsiRoadSegment[] = [];
  if (tiles.length > maxTiles) {
    console.warn(`国土地理院タイルが ${tiles.length} 枚で上限 ${maxTiles} 枚を超えるため、幅員なしで探索します`);
    return result;
  }

  const deadline = Date.now() + budgetMs;
  let next = 0;
  let skipped = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const tile = tiles[next++];
      try {
        const cached = await readCache(tile);
        if (cached) {
          result.push(...cached);
          continue;
        }
        // 時間の上限を過ぎたら、新しくは取得しない (キャッシュ済みのタイルは引き続き使う)
        if (Date.now() >= deadline) {
          skipped++;
          continue;
        }
        const geojson = await fetchTile(tile);
        const segments = geojson === null ? [] : parseGsiRoadTile(geojson);
        await saveCache(tile, segments);
        result.push(...segments);
      } catch (e) {
        console.warn(`国土地理院タイル ${GSI_TILE_ZOOM}/${tile.x}/${tile.y} の取得に失敗しました (幅員なしで続行)`, e);
      }
    }
  };
  await Promise.all([...Array(Math.min(MAX_CONCURRENT_FETCHES, tiles.length))].map(worker));
  if (skipped > 0) {
    console.warn(`国土地理院タイルの取得が ${budgetMs}ms を超えたため、${skipped} 枚は幅員なしで探索します`);
  }

  return result;
}
