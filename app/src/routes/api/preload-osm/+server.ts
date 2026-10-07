import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { z } from 'zod';
import { cacheManager } from '$lib/osm/fs-cache-manager';
import { fetchOverpassData } from '$lib/osm/osm-fetcher';
import { requireOSMData } from '$lib/osm';
import { RequestContext } from '$lib/tracing/requestContext';

const requestSchema = z.object({
  minLat: z.number(),
  minLng: z.number(),
  maxLat: z.number(),
  maxLng: z.number(),
});
export const POST: RequestHandler = async ({ request }) => {
  const requestedAt = new Date();
  const reqCtx = new RequestContext(requestedAt, "POST", request.url);
  try {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
      return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }
    const b = query.data;
    reqCtx.log(`boundary: minLat=${b.minLat} minLng=${b.minLng} maxLat=${b.maxLat} maxLng=${b.maxLng}`);

    // preload を目的としたリクエストなので、結果を無視する
    const { partial, reason } = await requireOSMData(reqCtx, query.data, cacheManager, fetchOverpassData, true);

    return json({ success: true, partial, reason });
  } catch (error) {
    reqCtx.logError(error);
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  } finally {
    reqCtx.endMeasurement();
  }
};
