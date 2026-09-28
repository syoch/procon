import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import type { Boundary } from "./boundary";
import { existsSync } from "fs";
import { env } from "$env/dynamic/private";
import type { OSMCacheManager } from "./types";

function getCacheDir(): string {
    const cacheDir = env.OSM_CACHE_DIR;
    if (!cacheDir) {
        throw new Error("OSM_CACHE_DIR 環境変数が設定されていません");
    }
    return cacheDir;
}

function encodeFilename(bound: Boundary) {
    return `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
}

async function saveCache(bound: Boundary, map: App.OSMData) {
    const CACHE_DIR = getCacheDir();
    if (existsSync(CACHE_DIR) === false) {
        await mkdir(CACHE_DIR, { recursive: true });
    }

    const fileName = join(CACHE_DIR, encodeFilename(bound));
    await writeFile(fileName, JSON.stringify(map));
}

async function readCache(bound: Boundary): Promise<App.OSMData | null> {
    try {
        const CACHE_DIR = getCacheDir();

        const fileName = join(CACHE_DIR, encodeFilename(bound));
        const content = (await readFile(fileName)).toString();
        const mapData = JSON.parse(content);

        return mapData;
    } catch (e) {
        if ((e as any).code === "ENOENT") {
            return null;
        } else {
            throw e;
        }
    }
}

export const cacheManager: OSMCacheManager = {
    saveCache,
    readCache,
};