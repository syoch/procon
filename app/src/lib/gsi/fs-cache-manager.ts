import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { env } from "$env/dynamic/private";
import type { GsiRoadSegment } from "./parse";
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
/**
 * メモリに持つタイル数の上限 (仮の値)。超えたら最も長く使われていないタイルから捨てる (ファイルのキャッシュは残る)
 * 探索 1 回の最大タイル数 (MAX_GSI_TILES) の 2 倍とした
 */
const MAX_MEMORY_TILES = 2048;

/** メモリのキャッシュに入れる (Map は追加順を保つので、先頭が最も長く使われていないタイル) */
function rememberTile(key: string, segments: GsiRoadSegment[]) {
  memoryCache.delete(key);
  memoryCache.set(key, segments);
  while (memoryCache.size > MAX_MEMORY_TILES) {
    const oldest = memoryCache.keys().next().value;
    if (oldest === undefined) break;
    memoryCache.delete(oldest);
  }
}

function encodeFilename(tile: GsiTile) {
  return `${GSI_TILE_ZOOM}-${tile.x}-${tile.y}.json`;
}

async function saveCache(tile: GsiTile, segments: GsiRoadSegment[]) {
  const dir = getCacheDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(join(dir, encodeFilename(tile)), JSON.stringify(segments));
  rememberTile(encodeFilename(tile), segments);
}

async function readCache(tile: GsiTile): Promise<GsiRoadSegment[] | null> {
  const key = encodeFilename(tile);
  const inMemory = memoryCache.get(key);
  if (inMemory) {
    rememberTile(key, inMemory);
    return inMemory;
  }
  try {
    const content = (await readFile(join(getCacheDir(), key))).toString();
    const segments: GsiRoadSegment[] = JSON.parse(content);
    rememberTile(key, segments);
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
