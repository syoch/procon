
import { type OSMCacheManager, type OSMFetcher } from './types';
import { mergeOSMData, SplitOSMData, trimOSMData } from './osm-data';
import { divideBoundary, simplifyBoundaries, type Boundary } from './boundary';
import type { RequestContext } from '$lib/tracing/requestContext';
import { MAX_OSM_CELLS } from './limits';

export { MAX_OSM_CELLS } from './limits';

/**
 * 取得対象セルが上限を超えたときに投げる。
 * 呼び出し元は利用者向けの応答 (path-find は 422) に変換する。
 */
export class OSMCellLimitError extends Error {
  readonly cells: number;
  readonly limit: number;
  constructor(cells: number, limit: number) {
    super(`OSM の取得対象セルが ${cells} 枚で上限 ${limit} 枚を超えています`);
    this.name = "OSMCellLimitError";
    this.cells = cells;
    this.limit = limit;
  }
}

/** 進行中の取得。覆っているセルを持ち、後続の要求はそれを join できる。 */
type InFlightFetch = {
  /** クエリ範囲の完全一致に使うキー */
  key: string;
  /** この取得が埋めるセル (1/64° 格子) のキー */
  cellKeys: Set<string>;
  promise: Promise<App.OSMData>;
};

/**
 * セル単位で進行中の取得を共有する。
 * 端点先読みと経路探索で範囲が少し違っても、重なるセルは 1 回の取得で賄う。
 * 完全一致は key で、部分一致は cellKeys で再利用する。
 * プロセス内のメモリで共有する (adapter-node は 1 プロセス)。
 */
const inFlightFetches = new Map<string, InFlightFetch>();

/**
 * in-flight entry を保持する時間 [ms]。
 * fetch がハングしても `.finally` が走らない間、entry を外して同じ範囲の再取得を妨げない。
 * undici の header/body timeout はそれぞれ 300 秒なので、それより早く外す。
 */
const IN_FLIGHT_TTL_MS = 60_000;

/** 1/64° 格子セルを一意に表すキー (セルは 1x1 境界なので minLat / minLng で足りる) */
function cellKey(b: Boundary): string {
  return `${b.minLat},${b.minLng}`;
}

/** クエリ範囲 (簡約後の矩形) の完全一致キー */
function fetchKey(boundaries: Boundary[]): string {
  return boundaries.map((b) => `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`).join("|");
}

/** 指定セルを既に覆っている進行中の取得 (無ければ undefined) */
function findCoveringFetch(key: string): InFlightFetch | undefined {
  for (const entry of inFlightFetches.values()) {
    if (entry.cellKeys.has(key)) return entry;
  }
  return undefined;
}

/**
 * 進行中の取得を await する対象と、まだ覆われていないセルに分ける。
 * ここでは await しない。欠けたセルの取得を先に始められるようにするため。
 */
function planInFlight(cells: Boundary[]): { joining: InFlightFetch[]; missing: Boundary[] } {
  const joining: InFlightFetch[] = [];
  const missing: Boundary[] = [];
  const seen = new Set<InFlightFetch>();
  for (const cell of cells) {
    const entry = findCoveringFetch(cellKey(cell));
    if (entry === undefined) {
      missing.push(cell);
      continue;
    }
    if (!seen.has(entry)) {
      seen.add(entry);
      joining.push(entry);
    }
  }
  return { joining, missing };
}

function fetchCoalesced(queryBoundaries: Boundary[], cells: Boundary[], fetchOSM: OSMFetcher): Promise<App.OSMData> {
  const key = fetchKey(queryBoundaries);
  const existing = inFlightFetches.get(key);
  if (existing !== undefined) return existing.promise;

  let entry!: InFlightFetch;
  const promise = fetchOSM(queryBoundaries).finally(() => {
    // 自分が今の entry のときだけ消す (watchdog が外した後に新しい fetch が入っていれば残す)
    if (inFlightFetches.get(key) === entry) inFlightFetches.delete(key);
  });
  entry = { key, cellKeys: new Set(cells.map(cellKey)), promise };

  // fetch は中断しない。entry だけ外して、次の要求が新しい fetch を始められるようにする
  const watchdog = setTimeout(() => {
    if (inFlightFetches.get(key) === entry) inFlightFetches.delete(key);
  }, IN_FLIGHT_TTL_MS);
  (watchdog as { unref?: () => void }).unref?.();

  inFlightFetches.set(key, entry);
  return promise;
}

/**
 * キャッシュを参照しつつ、OSM データを取得する。
 * @param boundary 取得対象の領域の境界情報
 * @param param1 OSMCache を直接扱う下位レイヤー
 * @param fetchOSM OSM を参照する下位レイヤー
 * @param ignoreResult 結果を無視するかのフラグ
 * @details
 *   ignoreResult フラグはシステムリソースを節約する用途に使われる
 *   取得対象セルが `MAX_OSM_CELLS` を超える場合は throw する
 *   進行中の取得が覆っているセルは join し、欠けたセルだけ取得する
 */
export async function requireOSMData(
  reqCtx: RequestContext,
  boundary: Boundary,
  { readCache, saveCache }: OSMCacheManager,
  fetchOSM: OSMFetcher,
  ignoreResult: boolean = false
): Promise<App.OSMData> {
  const dividedBoundaries = reqCtx.measure("divide", () => divideBoundary(boundary));

  const cacheReadMeasurement = reqCtx.begin("cache");
  const boundariesToGet: Boundary[] = [];
  const cachedChunks: App.OSMData[] = [];
  try {
    // セルを並列に読む。Promise.all は入力順で結果を返すので、
    // 完了順ではなく dividedBoundaries の順に詰め直せる
    const caches = await Promise.all(dividedBoundaries.map((b) => readCache(b)));
    for (let i = 0; i < dividedBoundaries.length; i++) {
      const cache = caches[i];
      if (cache === null) {
        boundariesToGet.push(dividedBoundaries[i]);
        continue
      }

      cachedChunks.push(cache);
    }
  } finally {
    // readCache が 1 つでも reject してもスパンを落とさない
    cacheReadMeasurement();
  }

  const capped = boundariesToGet.length > MAX_OSM_CELLS;

  // 進行中の取得が覆っているセルは join する。残りだけ取得する
  const { joining, missing } = planInFlight(boundariesToGet);
  reqCtx.log(`osm-cells requested=${dividedBoundaries.length} fetch=${boundariesToGet.length} missing=${missing.length} joined=${joining.length} limit=${MAX_OSM_CELLS} capped=${capped}`);

  if (capped) {
    throw new OSMCellLimitError(boundariesToGet.length, MAX_OSM_CELLS);
  }

  // join の完了を待つ間に欠けたセルの取得を進める
  const boundariesToQuery = missing.length > 0
    ? reqCtx.measure("simplify", () => simplifyBoundaries(missing))
    : [];
  const fetchPromise = missing.length > 0
    ? reqCtx.measureAsync("fetch", () => fetchCoalesced(boundariesToQuery, missing, fetchOSM))
    : null;

  if (joining.length > 0) {
    // 1 つの promise を複数箇所で await できる。join した分は fetch を増やさない
    const joined = await Promise.all(joining.map((entry) => entry.promise));
    cachedChunks.push(...joined);
  }

  if (fetchPromise !== null) {
    const fetchedData = await fetchPromise;

    const saveCacheMeasurement = reqCtx.begin("saveCache");
    const splittedGrids = SplitOSMData(fetchedData);
    // セルを並列に書き込む。saveCache は tmp ファイル名が pid と連番で一意なので衝突しない
    const subDatas = missing.map((b) => splittedGrids[`${b.minLat},${b.minLng}`] ?? { elements: [] });
    const saved = await Promise.allSettled(
      missing.map((b, i) => saveCache(b, subDatas[i])),
    );
    // 書込みが終わる前に throw すると、書きかけの tmp ファイルが残る
    const failed = saved.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed !== undefined) {
      throw failed.reason;
    }
    cachedChunks.push(...subDatas);
    saveCacheMeasurement();
  }

  if (ignoreResult) {
    return { elements: [] };
  }

  const mergedData: App.OSMData = { elements: [] };
  reqCtx.measure("merge", () => mergeOSMData(mergedData, ...cachedChunks));

  return reqCtx.measure("trim", () => trimOSMData(mergedData, boundary));
}
