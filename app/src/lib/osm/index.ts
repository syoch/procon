
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

/**
 * セル (1/64° 格子) ごとに進行中の取得の promise を共有する。
 * 1 回のクエリが覆う各セルに同じ promise を入れ、後続の要求はセルキーで直接引く。
 * 範囲が少し違っても重なるセルは 1 回の取得で賄う。
 * プロセス内のメモリで共有する (adapter-node は 1 プロセス)。
 */
const inFlightFetches = new Map<string, Promise<App.OSMData>>();

/**
 * in-flight entry を保持する時間 [ms]。
 * fetch がハングしても `then` が走らない間、entry を外して同じ範囲の再取得を妨げない。
 * undici の header/body timeout はそれぞれ 300 秒なので、それより早く外す。
 */
const IN_FLIGHT_TTL_MS = 60_000;

/** 1/64° 格子セルを一意に表すキー (セルは 1x1 境界なので minLat / minLng で足りる) */
function cellKey(b: Boundary): string {
  return `${b.minLat},${b.minLng}`;
}

/**
 * 要求セルを、既に進行中の取得が覆う分と、まだ無いセルに分ける。
 * 進行中の取得はセルキーで直接引く (走査しない)。
 */
function planInFlight(cells: Boundary[]): { joining: Promise<App.OSMData>[]; missing: Boundary[] } {
  const joining: Promise<App.OSMData>[] = [];
  const seen = new Set<Promise<App.OSMData>>();
  const missing: Boundary[] = [];
  for (const cell of cells) {
    const promise = inFlightFetches.get(cellKey(cell));
    if (promise === undefined) {
      missing.push(cell);
      continue;
    }
    // 同じクエリの promise が複数セルを覆うので、重複して await しない
    if (!seen.has(promise)) {
      seen.add(promise);
      joining.push(promise);
    }
  }
  return { joining, missing };
}

/**
 * クエリを開始し、覆う各セルに同じ promise を登録する。
 * 取得が終わる (または watchdog が外す) と、その promise を指す全セルキーから外す。
 */
function fetchAndRegister(cells: Boundary[], queryBoundaries: Boundary[], fetchOSM: OSMFetcher): Promise<App.OSMData> {
  const promise = fetchOSM(queryBoundaries);
  for (const cell of cells) {
    inFlightFetches.set(cellKey(cell), promise);
  }

  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    if (watchdog !== undefined) clearTimeout(watchdog);
    for (const [key, value] of inFlightFetches) {
      // 同じ promise を指すセルキーだけを外す (watchdog 後に別の取得が入っていれば残す)
      if (value === promise) inFlightFetches.delete(key);
    }
  };
  // fetch は中断しない。entry だけ外して、次の要求が新しい fetch を始められるようにする
  watchdog = setTimeout(remove, IN_FLIGHT_TTL_MS);
  (watchdog as { unref?: () => void }).unref?.();
  // 失敗しても unhandled rejection にしない (元の promise は呼び出し元が await する)
  promise.then(remove, remove);
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

  // 進行中の取得が覆っているセルは join し、残りだけ取得する
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
    ? reqCtx.measureAsync("fetch", () => fetchAndRegister(missing, boundariesToQuery, fetchOSM))
    : null;

  if (joining.length > 0) {
    // 1 つの promise を複数箇所で await できる。join した分は fetch を増やさない
    const joined = await Promise.all(joining);
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
