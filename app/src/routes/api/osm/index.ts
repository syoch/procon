
import { type OSMCacheManager, type OSMFetcher } from './types';
import { mergeOSMData, trimOSMData, type OSMData } from './osm-data';
import { divideBoundary, simplifyBoundaries, type Boundary } from './boundary';


export async function requireOSMData(boundary: Boundary, { readCache, saveCache }: OSMCacheManager, fetchOSM: OSMFetcher): Promise<OSMData> {
  const dividedBoundaries = divideBoundary(boundary);

  const boundariesToGet: Boundary[] = [];
  const cachedChunks: OSMData[] = [];
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

  const mergedData: OSMData = { elements: [] };
  for (const chunk of cachedChunks) {
    mergeOSMData(mergedData, chunk);
  }

  return trimOSMData(mergedData, boundary);
}