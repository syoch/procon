import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { type OSMCacheManager, type OSMFetcher } from '.';
import { mergeOSMData, trimOSMData, trimOSMDataByWayHighway, type OSMData } from './osm-data';
import { z } from 'zod';
import { divideBoundary, simplifyBoundaries, type Boundary } from './boundary';
import { cacheManager } from './fs-cache-manager';
import { fetchOverpassData } from './osm-fetcher';

async function requireOSMData(boundary: Boundary, { readCache, saveCache }: OSMCacheManager, fetchOSM: OSMFetcher): Promise<OSMData> {
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


const requestSchema = z.object({
  minLat: z.number(),
  minLng: z.number(),
  maxLat: z.number(),
  maxLng: z.number(),
  wayHighwayExcludes: z.array(z.string()),
});
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
      return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }

    const osmData = await requireOSMData(query.data, cacheManager, fetchOverpassData);

    const result = trimOSMDataByWayHighway(osmData, query.data.wayHighwayExcludes);

    return json(result);
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  }
};
