import { join } from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import type { OSMData } from "./osmdata";
import type { Boundary } from "./boundary";
import { existsSync } from "fs";

const CACHE_DIR = (() => {
    const cacheDir = process.env.OSM_CACHE_DIR;
    if (!cacheDir) {
        throw new Error("OSM_CACHE_DIR 環境変数が設定されていません");
    }
    return cacheDir;
})();

function encodeFilename(bound: Boundary) {
    return `${bound.minLat}-${bound.minLng}-${bound.maxLat}-${bound.maxLng}.json`;
}

export async function saveCache(bound: Boundary, map: OSMData) {
    if (existsSync(CACHE_DIR) === false) {
        await mkdir(CACHE_DIR, { recursive: true });
    }

    const fileName = join(CACHE_DIR, encodeFilename(bound));
    await writeFile(fileName, JSON.stringify(map));
}

export async function readCache(bound: Boundary): Promise<OSMData> {
    const fileName = join(CACHE_DIR, encodeFilename(bound));
    const content = (await readFile(fileName)).toString();
    const mapData = JSON.parse(content);

    return mapData;
}

