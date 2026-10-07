
import { type OSMCacheManager, type OSMFetcher } from './types';
import { mergeOSMData, SplitOSMData, trimOSMData } from './osm-data';
import { divideBoundary, simplifyBoundaries, type Boundary } from './boundary';
import type { RequestContext } from '$lib/tracing/requestContext';
import { MAX_OSM_CELLS } from './limits';

export { MAX_OSM_CELLS } from './limits';

/**
 * 同じ boundaries への同時 fetch を 1 回にまとめる。
 * 端点先読みと経路探索が重なったときの Overpass 二重取得を防ぐ。
 * プロセス内のメモリで共有する (adapter-node は 1 プロセス)。
 */
const inFlightFetches = new Map<string, Promise<App.OSMData>>();

function fetchKey(boundaries: Boundary[]): string {
  return boundaries.map((b) => `${b.minLat},${b.minLng},${b.maxLat},${b.maxLng}`).join("|");
}

function fetchCoalesced(boundaries: Boundary[], fetchOSM: OSMFetcher): Promise<App.OSMData> {
  const key = fetchKey(boundaries);
  const existing = inFlightFetches.get(key);
  if (existing !== undefined) return existing;

  // 失敗しても entry を残さない。finally は reject 時も走る
  const promise = fetchOSM(boundaries).finally(() => inFlightFetches.delete(key));
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
    throw new Error(`OSM の取得対象セルが ${boundariesToGet.length} 枚で上限 ${MAX_OSM_CELLS} 枚を超えています`);
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
