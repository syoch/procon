
import { type OSMCacheManager, type OSMFetcher } from './types';
import { mergeOSMData, SplitOSMData, trimOSMData } from './osm-data';
import { divideBoundary, simplifyBoundaries, type Boundary } from './boundary';
import type { RequestContext } from '$lib/requestContext';

/**
 * キャッシュを参照しつつ、OSM データを取得する。
 * @param boundary 取得対象の領域の境界情報
 * @param param1 OSMCache を直接扱う下位レイヤー
 * @param fetchOSM OSM を参照する下位レイヤー
 * @param ignoreResult 結果を無視するかのフラグ
 * @details
 *   ignoreResult フラグはシステムリソースを節約する用途に使われる
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
  for (const b of dividedBoundaries) {
    const cache = await readCache(b);
    if (cache === null) {
      boundariesToGet.push(b);
      continue
    }

    cachedChunks.push(cache);
  }
  cacheReadMeasurement();

  if (boundariesToGet.length > 0) {
    const boundariesToQuery = reqCtx.measure("simplify", () => simplifyBoundaries(boundariesToGet));
    const fetchedData = await reqCtx.measureAsync("fetch", () => fetchOSM(boundariesToQuery));

    const saveCacheMeasurement = reqCtx.begin("saveCache");
    const splittedGrids = new Map(SplitOSMData(fetchedData).map(x => [`${x.lat},${x.lng}`, x.map]));
    for (const b of boundariesToGet) {
      const subData = splittedGrids.get(`${b.minLat},${b.minLat}`) ?? { elements: [] };
      await saveCache(b, subData);
      cachedChunks.push(subData);
    }
    saveCacheMeasurement();

  }

  if (ignoreResult) {
    return { elements: [] };
  }

  const mergedData: App.OSMData = { elements: [] };
  reqCtx.measure("merge", () => mergeOSMData(mergedData, ...cachedChunks));

  return reqCtx.measure("trim", () => trimOSMData(mergedData, boundary));
}