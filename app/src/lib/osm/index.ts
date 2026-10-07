
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
 * 同じ boundaries への同時 fetch を 1 回にまとめる。
 * 端点先読みと経路探索が重なったときの Overpass 二重取得を防ぐ。
 * プロセス内のメモリで共有する (adapter-node は 1 プロセス)。
 */
const inFlightFetches = new Map<string, Promise<App.OSMData>>();

/**
 * in-flight entry を保持する時間 [ms]。
 * fetch がハングしても `.finally` が走らない間、entry を外して同じ範囲の再取得を妨げない。
 * undici の header/body timeout はそれぞれ 300 秒なので、それより早く外す。
 */
const IN_FLIGHT_TTL_MS = 60_000;

function fetchKey(boundaries: Boundary[]): string {
  return boundaries.map((b) => `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`).join("|");
}

function fetchCoalesced(boundaries: Boundary[], fetchOSM: OSMFetcher): Promise<App.OSMData> {
  const key = fetchKey(boundaries);
  const existing = inFlightFetches.get(key);
  if (existing !== undefined) return existing;

  let promise!: Promise<App.OSMData>;
  promise = fetchOSM(boundaries).finally(() => {
    // 自分が今の entry のときだけ消す (watchdog が外した後に新しい fetch が入っていれば残す)
    if (inFlightFetches.get(key) === promise) inFlightFetches.delete(key);
  });

  // fetch は中断しない。entry だけ外して、次の要求が新しい fetch を始められるようにする
  const watchdog = setTimeout(() => {
    if (inFlightFetches.get(key) === promise) inFlightFetches.delete(key);
  }, IN_FLIGHT_TTL_MS);
  (watchdog as { unref?: () => void }).unref?.();

  inFlightFetches.set(key, promise);
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
  reqCtx.log(`osm-cells requested=${dividedBoundaries.length} fetch=${boundariesToGet.length} limit=${MAX_OSM_CELLS} capped=${capped}`);

  if (capped) {
    throw new OSMCellLimitError(boundariesToGet.length, MAX_OSM_CELLS);
  }

  if (boundariesToGet.length > 0) {
    const boundariesToQuery = reqCtx.measure("simplify", () => simplifyBoundaries(boundariesToGet));
    const fetchedData = await reqCtx.measureAsync("fetch", () => fetchCoalesced(boundariesToQuery, fetchOSM));

    const saveCacheMeasurement = reqCtx.begin("saveCache");
    const splittedGrids = SplitOSMData(fetchedData);
    // セルを並列に書き込む。saveCache は tmp ファイル名が pid と連番で一意なので衝突しない
    const subDatas = boundariesToGet.map((b) => splittedGrids[`${b.minLat},${b.minLng}`] ?? { elements: [] });
    const saved = await Promise.allSettled(
      boundariesToGet.map((b, i) => saveCache(b, subDatas[i])),
    );
    // 書込みが終わる前に throw すると、書きかけの tmp ファイルが残る
    const failed = saved.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (failed !== undefined) {
      throw failed.reason;
    }
    // cachedChunks は後続の merge に spread で渡すため、並列化しても boundariesToGet の順に積む
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
