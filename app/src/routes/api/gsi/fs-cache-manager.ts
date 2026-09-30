import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { env } from "$env/dynamic/private";
import type { GsiRoadSegment } from "$lib/road_width";
import { GSI_TILE_ZOOM, type GsiCacheManager, type GsiTile } from ".";

/** OSM のキャッシュと同じディレクトリの下の gsi/ に保存する */
function getCacheDir(): string {
  const cacheDir = env.OSM_CACHE_DIR;
  if (!cacheDir) {
    throw new Error("OSM_CACHE_DIR 環境変数が設定されていません");
  }
  return join(cacheDir, "gsi");
}

/**
 * 読み込んだタイルをメモリにも持っておく (探索のたびに数百枚のファイルを読み直さないため)
 * タイル 1 枚は数十〜数百区間なので、長岡周辺の数千枚でもメモリ量は小さい
 */
const memoryCache = new Map<string, GsiRoadSegment[]>();

function encodeFilename(tile: GsiTile) {
  return `${GSI_TILE_ZOOM}-${tile.x}-${tile.y}.json`;
}

async function saveCache(tile: GsiTile, segments: GsiRoadSegment[]) {
  const dir = getCacheDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(join(dir, encodeFilename(tile)), JSON.stringify(segments));
  memoryCache.set(encodeFilename(tile), segments);
}

async function readCache(tile: GsiTile): Promise<GsiRoadSegment[] | null> {
  const key = encodeFilename(tile);
  const inMemory = memoryCache.get(key);
  if (inMemory) return inMemory;
  try {
    const content = (await readFile(join(getCacheDir(), key))).toString();
    const segments: GsiRoadSegment[] = JSON.parse(content);
    memoryCache.set(key, segments);
    return segments;
  } catch (e) {
    if ((e as { code?: string }).code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

export const gsiCacheManager: GsiCacheManager = {
  saveCache,
  readCache,
};
