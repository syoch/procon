import { simplifyBoundaries, type Boundary } from "./boundary";
import { isOSMData, trimOSMData } from "./osm-data";
import type { OSMFetcher } from "./types";

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
    /** 空データだったので保存・削除を見送ったセル数 */
    skipped: number;
    failed: number;
    /** 1 クエリに含まれた bbox 句の数。HTTP リクエストは常に 1 回 */
    regions: number;
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
 *
 * 既知の制約: 空でないが不完全な応答はそのまま保存され mtime も更新される。
 * 古いデータを失って次周期まで TTL が解けなくなるが、次の実行で回復する。
 */
export async function refreshExpiredOSMCache(
    listCached: ListCachedCells,
    fetchOSM: OSMFetcher,
    saveCache: (bound: Boundary, map: App.OSMData) => Promise<void>,
    {
        removeCache,
        readCache,
    }: {
        /** 空・壊れたセルを削除する。省略すると削除しないので `{elements:[]}` の
         *  残骸を掃除できず、毎晩 500 が恒続する */
        removeCache?: (bound: Boundary) => Promise<void>;
        /** 空・壊れたデータをヒットにしないので `null` がその判定になる */
        readCache?: (bound: Boundary) => Promise<App.OSMData | null>;
    } = {},
    options: { now?: number; ttlMs?: number } = {},
): Promise<RefreshResult> {
    const now = options.now ?? Date.now();
    const ttl = options.ttlMs ?? Infinity;

    const cells = await listCached();
    const result: RefreshResult = {
        scanned: cells.length,
        expired: 0,
        refreshed: 0,
        skipped: 0,
        failed: 0,
        regions: 0,
    };

    // 古い順に処理して、1 回の実行で得られる成果が最大になる
    const expired = cells
        .filter((cell) => now - cell.fetchedAt > ttl)
        .sort((a, b) => a.fetchedAt - b.fetchedAt);
    result.expired = expired.length;
    if (expired.length === 0) {
        return result;
    }

    const queries = simplifyBoundaries(expired.map((cell) => cell.bound));
    result.regions = queries.length;

    let fetched: App.OSMData;
    try {
        fetched = await fetchOSM(queries);
    } catch (e) {
        console.warn(`OSM キャッシュの更新に失敗しました (${queries.length} 領域)`, e);
        result.failed = expired.length;
        return result;
    }

    // 壊れた要素は下の trimOSMData で TypeError になり、セルごとの try の外なので
    // 走査全体が落ちる。まとめて検証しておく
    if (!isOSMData(fetched)) {
        console.warn(`OSM キャッシュの更新に失敗しました: 応答の形式が想定と異なります (${queries.length} 領域)`);
        result.failed = expired.length;
        return result;
    }

    for (const cell of expired) {
        // simplifyBoundaries の出力は必ず入力セルを内包するので、ここに外れるのは
        // キャッシュディレクトリに手作りのファイルが混ざった場合だけ
        if (!queries.some((query) => isCoveredBy(cell.bound, query))) {
            console.warn(`OSM キャッシュ更新: クエリ領域に含まれないセルを飛ばしました: ${cell.bound.minLat},${cell.bound.minLng},${cell.bound.maxLat},${cell.bound.maxLng}`);
            result.failed += 1;
            continue;
        }

        const trimmed = trimOSMData(fetched, cell.bound);
        if (trimmed.elements.length === 0) {
            /**
             * 「trim が空」≠「ディスクのファイルが空」ではない。trimOSMData は
             * セルの外側ノードしか含まれない応答でも空を返すので、削除条件に
             * ディスクの状態を使うと一過的な異常応答で有効データを消してしまう。
             * 空で上書きすると mtime が解けて TTL の間地図が空のままになるため、
             * saveCache は空を保存せず，这里でも skipped に数える。
             */
            if (removeCache && readCache) {
                // readCache は EACCES などを再スローするので try に入れる。
                // 判断できなければ削除しない（削除は取り消せない）
                try {
                    if ((await readCache(cell.bound)) === null) {
                        await removeCache(cell.bound);
                    }
                } catch (e) {
                    console.warn(`キャッシュの読み取りまたは削除に失敗しました: ${cell.bound.minLat},${cell.bound.minLng},${cell.bound.maxLat},${cell.bound.maxLng}`, e);
                    result.failed += 1;
                    continue;
                }
            }
            result.skipped += 1;
            continue;
        }

        try {
            await saveCache(cell.bound, trimmed);
            result.refreshed += 1;
        } catch (e) {
            console.warn(`OSM キャッシュの保存に失敗しました: ${cell.bound.minLat},${cell.bound.minLng},${cell.bound.maxLat},${cell.bound.maxLng}`, e);
            result.failed += 1;
        }
    }

    return result;
}
