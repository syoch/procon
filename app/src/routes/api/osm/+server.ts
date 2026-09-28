import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { trimOSMDataByWayHighway } from './osm-data';
import { z } from 'zod';
import { cacheManager } from './fs-cache-manager';
import { fetchOverpassData } from './osm-fetcher';
import { requireOSMData } from '.';


const requestSchema = z.object({
  minLat: z.number(),
  minLng: z.number(),
  maxLat: z.number(),
  maxLng: z.number(),
  wayHighway: z.array(z.string()),
});
export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
      return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }

    const osmData = await requireOSMData(query.data, cacheManager, fetchOverpassData);

    const result = trimOSMDataByWayHighway(osmData, query.data.wayHighway);

    return json(result);
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  }
};
