import { join } from "path";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "fs/promises";
import type { Boundary } from "./boundary";
import { existsSync } from "fs";
import { env } from "$env/dynamic/private";
import type { OSMCacheManager } from "./types";
import type { CachedCell } from "./expired-cache";
import { isOSMData } from "./osm-data";

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

/**
 * `split("-")` では西経・南緯で壊れるので正規表現で切り出す。
 * 数値 4 個で終わらないので一時ファイルは一致しない。
 */
function decodeFilename(fileName: string): Boundary | null {
    const matched = /^(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)\.json$/.exec(fileName);
    if (!matched) {
        return null;
    }
    const bound = {
        minLat: Number(matched[1]),
        minLng: Number(matched[2]),
        maxLat: Number(matched[3]),
        maxLng: Number(matched[4]),
    };
    // 往復検証。数値の解釈が違えば復元できない
    if (![bound.minLat, bound.minLng, bound.maxLat, bound.maxLng].every(Number.isFinite)) {
        return null;
    }
    return encodeFilename(bound) === fileName ? bound : null;
}

/** `-tmp.` の後に数字 2 組を見ることで `my-important-tmp.backup.json` などは消さない */
const TEMP_FILE_RE = /-tmp\.\d+\.\d+\.json$/;

let saveSeq = 0;

/** Windows は同じセルへの並行 rename で一時的に EPERM を返す。待機して再試行する */
const RENAME_EPERM_MAX_RETRY = 5;
const RENAME_EPERM_BASE_DELAY_MS = 10;

function isEPERM(e: unknown): boolean {
    return (e as { code?: string }).code === "EPERM";
}

async function renameWithRetry(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt++) {
        try {
            await rename(from, to);
            return;
        } catch (e) {
            if (attempt >= RENAME_EPERM_MAX_RETRY || isEPERM(e) === false) {
                throw e;
            }
            await new Promise((resolve) => setTimeout(resolve, RENAME_EPERM_BASE_DELAY_MS * 2 ** attempt));
        }
    }
}

async function saveCache(bound: Boundary, map: App.OSMData) {
    const CACHE_DIR = getCacheDir();
    if (existsSync(CACHE_DIR) === false) {
        await mkdir(CACHE_DIR, { recursive: true });
    }

    const base = encodeFilename(bound).replace(/\.json$/, "");
    // 一意な名前 → rename の atomic で中断されても本番ファイルは壊れない。
    // 共有名にすると非同期 I/O が交錯して内容が混ざる
    const tmpFileName = join(CACHE_DIR, `${base}-tmp.${process.pid}.${saveSeq++}.json`);
    try {
        await writeFile(tmpFileName, JSON.stringify(map));
        await renameWithRetry(tmpFileName, join(CACHE_DIR, `${base}.json`));
    } catch (e) {
        await rm(tmpFileName, { force: true }).catch(() => { }); // 掃除が失敗しても原因を隠さない
        throw e;
    }
}

async function readCache(bound: Boundary): Promise<App.OSMData | null> {
    try {
        const CACHE_DIR = getCacheDir();

        const fileName = join(CACHE_DIR, encodeFilename(bound));
        const content = (await readFile(fileName)).toString();
        const mapData: unknown = JSON.parse(content);

        // 壊れたデータだけを弾く。
        if (!isOSMData(mapData)) {
            return null;
        }

        return mapData;
    } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") {
            return null;
        } else if (e instanceof SyntaxError) {
            // 壊れたキャッシュは再取得で修復する（従来は経路探索ごと 500 にしていた）
            console.warn(`OSM キャッシュが壊れているため再取得します: ${encodeFilename(bound)}`, e);
            return null;
        } else {
            throw e;
        }
    }
}

export async function cleanupStaleTempFiles(olderThanMs = 3600_000): Promise<number> {
    const CACHE_DIR = getCacheDir();

    let fileNames: string[];
    try {
        fileNames = await readdir(CACHE_DIR);
    } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") {
            return 0;
        }
        throw e;
    }

    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const fileName of fileNames) {
        if (!TEMP_FILE_RE.test(fileName)) continue;
        const filePath = join(CACHE_DIR, fileName);
        try {
            const fileStat = await stat(filePath);
            if (fileStat.mtimeMs >= cutoff) continue; // 実行中の書き込みかもしれない
            await rm(filePath, { force: true });
            removed += 1;
        } catch (e) {
            if ((e as { code?: string }).code !== "ENOENT") {
                throw e;
            }
        }
    }
    if (removed > 0) {
        console.warn(`OSM キャッシュの一時ファイルを ${removed} 件削除しました`);
    }
    return removed;
}

/**
 * 取得時刻はファイル mtime で持つ。`App.OSMData` に埋め込むと
 * trimOSMData が `{ elements: [] }` を作り直すときに失われるため。
 */
export async function listCachedOSMCells(): Promise<CachedCell[]> {
    const CACHE_DIR = getCacheDir();

    let fileNames: string[];
    try {
        fileNames = await readdir(CACHE_DIR);
    } catch (e) {
        if ((e as { code?: string }).code === "ENOENT") {
            return [];
        }
        throw e;
    }

    const cells: CachedCell[] = [];
    const undecodable: string[] = [];
    for (const fileName of fileNames) {
        const bound = decodeFilename(fileName);
        if (!bound) {
            // 一時ファイルは日常的に混ざる。それ以外は書式が変わった可能性があり、
            // 無音で無視するとキャッシュ全体が更新対象から消えたまま気づけない
            if (!TEMP_FILE_RE.test(fileName)) undecodable.push(fileName);
            continue;
        }
        try {
            const fileStat = await stat(join(CACHE_DIR, fileName));
            cells.push({ bound, fetchedAt: fileStat.mtimeMs });
        } catch (e) {
            if ((e as { code?: string }).code !== "ENOENT") { // 列挙中に消えたものは無視
                throw e;
            }
        }
    }
    if (undecodable.length > 0) {
        console.warn(`復元できないキャッシュファイルが ${undecodable.length} 件ありました (更新対象から除外されます): ${undecodable.slice(0, 5).join(", ")}`);
    }
    return cells;
}

export const cacheManager: OSMCacheManager = {
    saveCache,
    readCache,
};
