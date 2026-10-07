/**
 * デモで使う領域の OSM キャッシュを温める。
 *
 * `/api/preload-osm` は `{begin,end}` から 1 つの bbox を作り、
 * `MAX_OSM_CELLS` を超えると 422 で弾かれる。
 * デモ用領域は 1 クエリに載らないので分割して取る。
 *
 * 1 クエリに載せるセル数は `CELLS_PER_QUERY` で決める。
 * 512 セルを 1 クエリにすると Overpass が 504 を返し、
 * 144 セルでは `[timeout:30]` の remark が付く（2026-10-07 の実測）。
 *
 * @ref README.md#デモ用領域のプリロード
 */
import { setTimeout as sleep } from "node:timers/promises";

import { cacheManager } from "../../src/lib/osm/fs-cache-manager";
import { fetchOverpassData } from "../../src/lib/osm/osm-fetcher";
import { divideBoundary, simplifyBoundaries, type Boundary } from "../../src/lib/osm/boundary";
import { SplitOSMData } from "../../src/lib/osm/osm-data";
import { PRELOAD_REGIONS, regionNames } from "./preload-regions";

/** 公開されている Overpass のエンドポイント。`OVERPASS_ENDPOINT` で差し替えられる */
const DEFAULT_OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

/**
 * 1 クエリに載せるセル数。
 * 東京密集部で 64 セルが 55.9 MB / 27 秒で通る実測値（2026-10-07）。
 * これを超えると remark か 504 になる。
 */
const CELLS_PER_QUERY = 64;

/** クエリ間の待機 [ms]。Overpass の fair use は 1 クエリ/分以下が目安 */
const INTERVAL_MS = 60_000;

/** 1 クエリの取り直し回数 */
const MAX_ATTEMPTS = 3;

/**
 * 取り直しの待ち時間 [ms]。
 * Overpass の指針は 429 / 406 に対して 30 秒の待機を挙げている。
 */
const RETRY_WAIT_MS = 30_000;

/**
 * セルファイル 1 件の平均サイズ [bytes]。見積もりに使う。
 * 高松 72 セルと東京 170 セルを実際に取得した実測値（平均 357 KB、中央値 358 KB、2026-10-07）。
 */
const ASSUMED_BYTES_PER_CELL = 360_000;

/** 1 クエリの平均応答時間 [ms]。実測 8〜30 秒の中間 */
const ASSUMED_MS_PER_QUERY = 20_000;

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

/** セルを `size` 個ずつに切る */
function chunk(cells: Boundary[], size: number): Boundary[][] {
    const chunks: Boundary[][] = [];
    for (let i = 0; i < cells.length; i += size) {
        chunks.push(cells.slice(i, i + size));
    }
    return chunks;
}

/** 1 チャンクを取得してセルごとに保存する */
async function fetchChunk(cells: Boundary[]): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            const fetched = await fetchOverpassData(simplifyBoundaries(cells));
            const splitted = SplitOSMData(fetched);
            const subDatas = cells.map((b) => splitted[`${b.minLat},${b.minLng}`] ?? { elements: [] });
            await Promise.all(cells.map((b, i) => cacheManager.saveCache(b, subDatas[i])));
            return;
        } catch (error) {
            if (attempt >= MAX_ATTEMPTS) throw error;
            const message = error instanceof Error ? error.message : String(error);
            console.log(`    失敗: ${message} / ${RETRY_WAIT_MS / 1000} 秒置いて取り直します（${attempt} 回目）`);
            await sleep(RETRY_WAIT_MS);
        }
    }
}

function formatBoundary(b: Boundary): string {
    return `${b.minLat.toFixed(6)},${b.minLng.toFixed(6)} .. ${b.maxLat.toFixed(6)},${b.maxLng.toFixed(6)}`;
}

function formatMb(bytes: number): string {
    return `${(bytes / 1e6).toFixed(1)} MB`;
}

/** 実行せずに、セル数・クエリ数・所要時間・容量の見積もりを出す */
async function estimateOnly(names: string[]): Promise<void> {
    console.log("見積もりのみです。取得するには --run を付けます\n");
    let totalCells = 0;
    for (const name of names) {
        const region = PRELOAD_REGIONS[name];
        if (region === undefined) throw new Error(`不明な領域です: ${name}`);
        const cells = divideBoundary(region.boundary);
        const queries = Math.ceil(cells.length / CELLS_PER_QUERY);
        totalCells += cells.length;
        console.log(`${name}: ${region.description}`);
        console.log(`  範囲: ${formatBoundary(region.boundary)}`);
        console.log(`  セル: ${cells.length}`);
        console.log(`  クエリ: ${queries} 回（${CELLS_PER_QUERY} セル/回）`);
        console.log(`  容量: ${formatMb(cells.length * ASSUMED_BYTES_PER_CELL)}`);
        console.log(`  所要: 約 ${Math.ceil((queries * (ASSUMED_MS_PER_QUERY + INTERVAL_MS)) / 60_000)} 分`);
    }
    const queries = Math.ceil(totalCells / CELLS_PER_QUERY);
    console.log(`\n合計: ${totalCells} セル / ${queries} クエリ`);
    console.log(`  容量: ${formatMb(totalCells * ASSUMED_BYTES_PER_CELL)}`);
    console.log(`  所要: 約 ${Math.ceil((queries * (ASSUMED_MS_PER_QUERY + INTERVAL_MS)) / 60_000)} 分`);
    console.log(`\nキャッシュ先: ${cacheDir()}`);
}

async function run(names: string[]): Promise<void> {
    const started = Date.now();
    for (const name of names) {
        const region = PRELOAD_REGIONS[name];
        if (region === undefined) throw new Error(`不明な領域です: ${name}`);
        const cells = divideBoundary(region.boundary);
        const missing = await missingCells(cells);
        console.log(`${name}: ${cells.length} セル（うち ${missing.length} が未取得）`);
        console.log(`  範囲: ${formatBoundary(region.boundary)}`);
        if (missing.length === 0) continue;

        const chunks = chunk(missing, CELLS_PER_QUERY);
        for (let i = 0; i < chunks.length; i++) {
            // 最初の 1 回も公平性のため間隔を置く
            await sleep(INTERVAL_MS);
            await fetchChunk(chunks[i]);
            console.log(
                `  [${i + 1}/${chunks.length}] ${chunks[i].length} セル取得 / ` +
                    `累計 ${Math.round((Date.now() - started) / 60_000)} 分`,
            );
        }
    }
    console.log(`完了しました（${Math.round((Date.now() - started) / 60_000)} 分）`);
}

function parseArgs(argv: string[]): { names: string[]; shouldRun: boolean } {
    const names: string[] = [];
    let shouldRun = false;
    for (const arg of argv) {
        if (arg === "--run") shouldRun = true;
        else if (arg === "--all") names.push(...regionNames());
        else if (arg.startsWith("--region=")) names.push(arg.slice("--region=".length));
        // 出力先は環境変数でも引数でも指定できるようにする。
        // このマシンの正のキャッシュは `OSM_CACHE_DIR` が既に指している
        else if (arg.startsWith("--cache-dir=")) {
            process.env.OSM_CACHE_DIR = arg.slice("--cache-dir=".length);
        } else throw new Error(`不明な引数です: ${arg}`);
    }
    if (names.length === 0) names.push(...regionNames());
    return { names, shouldRun };
}

async function main(): Promise<void> {
    const { names, shouldRun } = parseArgs(process.argv.slice(2));
    process.env.OVERPASS_ENDPOINT ??= DEFAULT_OVERPASS_ENDPOINT;
    if (shouldRun === false) {
        await estimateOnly(names);
        return;
    }
    console.log(`Overpass: ${process.env.OVERPASS_ENDPOINT}`);
    console.log(`キャッシュ先: ${cacheDir()}`);
    console.log(`1 クエリ ${CELLS_PER_QUERY} セル / 間隔 ${INTERVAL_MS / 1000} 秒\n`);
    await run(names);
}

await main();