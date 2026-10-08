import { simplifyBoundaries, type Boundary } from "./boundary";
import { isOSMData, trimOSMData } from "./osm-data";
import type { OSMFetcher } from "./types";
import { MAX_OSM_CELLS } from "./limits";

export type CachedCell = {
    bound: Boundary;
    /** ファイルの mtime [ms] */
    fetchedAt: number;
};

export type ListCachedCells = () => Promise<CachedCell[]>;

export const DEFAULT_TTL_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * `0` (失効させない) と数値として解釈できない値を区別する。
 * 後者を Infinity にすると `OSM_CACHE_TTL_DAYS=30日` のような打ち間違いで
 * 更新がログも残らず永久に止まる。
 */
export function ttlMs(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === "") {
        return DEFAULT_TTL_DAYS * MS_PER_DAY;
    }
    const days = Number(raw);
    // -0 は `days === 0` が真になるため、意図した 0 と区別する
    if (days === 0 && !Object.is(days, -0)) {
        return Infinity;
    }
    // 積のオーバーフローは `Number.isFinite(days)` を通ってしまうので別途見る
    if (!Number.isFinite(days) || Object.is(days, -0) || days < 0 || !Number.isFinite(days * MS_PER_DAY)) {
        console.warn(
            `OSM_CACHE_TTL_DAYS="${raw}" を解釈できないため、既定の ${DEFAULT_TTL_DAYS} 日として扱います。失効させない場合は "0" を指定してください`,
        );
        return DEFAULT_TTL_DAYS * MS_PER_DAY;
    }
    return days * MS_PER_DAY;
}

export type RefreshResult = {
    scanned: number;
    expired: number;
    refreshed: number;
    failed: number;
    /** 1 クエリに含まれた bbox 句の数。HTTP リクエストは常に 1 回 */
    regions: number;
    /** セル数の上限により次回以降に回した失効セル */
    deferred: number;
};

function isCoveredBy(cell: Boundary, query: Boundary): boolean {
    return cell.minLat >= query.minLat
        && cell.maxLat <= query.maxLat
        && cell.minLng >= query.minLng
        && cell.maxLng <= query.maxLng;
}

/**
 * TTL を超えたセルをまとめて取り直す。`procon-cache-refresh.timer` から定期実行される。
 *
 * 失効セルを `simplifyBoundaries` でまとめてから 1 回だけ問い合わせる。
 * `simplifyBoundaries` はリクエスト数ではなく取得データ量の重複を減らすので、
 * 散在セルでは bbox 句（`regions`）が増えても HTTP リクエストは 1 回のまま。
 * 1 回で処理するセルは `MAX_OSM_CELLS` 枚までにし、残りは次回に回す。
 *
 */
export async function refreshExpiredOSMCache(
    listCached: ListCachedCells,
    fetchOSM: OSMFetcher,
    saveCache: (bound: Boundary, map: App.OSMData) => Promise<void>,
    options: { now?: number; ttlMs?: number } = {},
): Promise<RefreshResult> {
    const now = options.now ?? Date.now();
    const ttl = options.ttlMs ?? Infinity;

    const cells = await listCached();
    const result: RefreshResult = {
        scanned: cells.length,
        expired: 0,
        refreshed: 0,
        failed: 0,
        regions: 0,
        deferred: 0,
    };

    // 古い順に処理して、1 回の実行で得られる成果が最大になる
    const expired = cells
        .filter((cell) => now - cell.fetchedAt > ttl)
        .sort((a, b) => a.fetchedAt - b.fetchedAt);
    result.expired = expired.length;
    if (expired.length === 0) {
        return result;
    }

    // 1 回のクエリのデータ量を抑える。残りは次回の実行に回す
    const batch = expired.slice(0, MAX_OSM_CELLS);
    result.deferred = expired.length - batch.length;

    const queries = simplifyBoundaries(batch.map((cell) => cell.bound));
    result.regions = queries.length;

    let fetched: App.OSMData;
    try {
        fetched = await fetchOSM(queries);
    } catch (e) {
        console.warn(`OSM キャッシュの更新に失敗しました (${queries.length} 領域)`, e);
        result.failed = batch.length;
        return result;
    }

    // 壊れた要素は下の trimOSMData で TypeError になり、セルごとの try の外なので
    // 走査全体が落ちる。まとめて検証しておく
    if (!isOSMData(fetched)) {
        console.warn(`OSM キャッシュの更新に失敗しました: 応答の形式が想定と異なります (${queries.length} 領域)`);
        result.failed = batch.length;
        return result;
    }

    for (const cell of batch) {
        // simplifyBoundaries の出力は必ず入力セルを内包するので、ここに外れるのは
        // キャッシュディレクトリに手作りのファイルが混ざった場合だけ
        if (!queries.some((query) => isCoveredBy(cell.bound, query))) {
            console.warn(`OSM キャッシュ更新: クエリ領域に含まれないセルを飛ばしました: ${cell.bound.minLat},${cell.bound.minLng},${cell.bound.maxLat},${cell.bound.maxLng}`);
            result.failed += 1;
            continue;
        }

        try {
            await saveCache(cell.bound, trimOSMData(fetched, cell.bound));
            result.refreshed += 1;
        } catch (e) {
            console.warn(`OSM キャッシュの保存に失敗しました: ${cell.bound.minLat},${cell.bound.minLng},${cell.bound.maxLat},${cell.bound.maxLng}`, e);
            result.failed += 1;
        }
    }

    return result;
}
