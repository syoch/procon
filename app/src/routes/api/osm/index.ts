
import { type OSMCacheManager, type OSMFetcher } from './types';
import { mergeOSMData, trimOSMData } from './osm-data';
import { divideBoundary, simplifyBoundaries, type Boundary } from './boundary';

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
  boundary: Boundary,
  { readCache, saveCache }: OSMCacheManager,
  fetchOSM: OSMFetcher,
  ignoreResult: boolean = false
): Promise<App.OSMData> {
  const dividedBoundaries = divideBoundary(boundary);

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

  if (boundariesToGet.length > 0) {
    const boundariesToQuery = simplifyBoundaries(boundariesToGet);
    const fetchedData = await fetchOSM(boundariesToQuery);

    for (const b of boundariesToGet) {
      const subData = trimOSMData(fetchedData, b);
      await saveCache(b, subData);
      cachedChunks.push(subData);
    }
  }

  if (ignoreResult) {
    return { elements: [] };
  }

  const mergedData: App.OSMData = { elements: [] };
  mergeOSMData(mergedData, ...cachedChunks);

  return trimOSMData(mergedData, boundary);
}