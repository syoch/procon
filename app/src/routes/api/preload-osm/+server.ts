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
  const reqCtx = new RequestContext();
  try {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
      return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }
    reqCtx.log(`boundary: ${JSON.stringify(query.data)}`);

    // preload を目的としたリクエストなので、結果を無視する
    await requireOSMData(reqCtx, query.data, cacheManager, fetchOverpassData, true);

    return json({ success: true });
  } catch (error) {
    reqCtx.logError(error);
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  } finally {
    reqCtx.endMeasurement(requestedAt, "POST", request.url);
  }
};
