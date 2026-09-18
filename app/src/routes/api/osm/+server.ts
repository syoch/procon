import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import type { Boundary } from './boundary';
import { requireOSMData } from '.';
import { trimOSMDataByWayHighway } from './osmdata';
import { z } from 'zod';

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
      return json({ error: 'Invalid request body', details: query.error }, { status: 400 });
    }

    const osmData = await requireOSMData(query.data);

    const result = trimOSMDataByWayHighway(osmData, query.data.wayHighwayExcludes);

    return json(result);
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  }
};