import type { Boundary } from "../osm/boundary";
import { parseGsiRoadTile, type GsiRoadSegment } from "$lib/road_width";

/** 国土地理院の道路中心線タイルのズームレベル (提供されているのは 16 のみ) */
export const GSI_TILE_ZOOM = 16;
/** 同時に取得するタイル数の上限 (国土地理院のサーバーに一度に大量のリクエストを送らないため) */
const MAX_CONCURRENT_FETCHES = 4;

export type GsiTile = { x: number; y: number };

/** タイル 1 枚を取得する (タイルが存在しない場合は null) */
export type GsiTileFetcher = (tile: GsiTile) => Promise<unknown | null>;

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
 * 範囲内の国土地理院の道路中心線 (幅員の分かる車道の区間) を取得する
 *
 * タイル単位でキャッシュし、未キャッシュのタイルだけを取得する。
 * 取得 (キャッシュの読み書きを含む) に失敗したタイルは空として扱い (キャッシュはしない)、
 * 経路探索自体は幅員なしで続けられるようにする。
 */
export async function requireGsiRoadSegments(
  boundary: Boundary,
  { readCache, saveCache }: GsiCacheManager,
  fetchTile: GsiTileFetcher,
): Promise<GsiRoadSegment[]> {
  const tiles = tilesForBoundary(boundary);
  const result: GsiRoadSegment[] = [];

  let next = 0;
  const worker = async () => {
    while (next < tiles.length) {
      const tile = tiles[next++];
      try {
        const cached = await readCache(tile);
        if (cached) {
          result.push(...cached);
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

  return result;
}
