import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import type { Boundary } from './boundary';
import { requireOSMData } from '.';
import { trimOSMDataByWayHighway } from './osmdata';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as Boundary & { wayHighwayExcludes: string[] };
    const osmData = await requireOSMData(body);
    const result = trimOSMDataByWayHighway(osmData, body.wayHighwayExcludes);
    return json(result);
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  }
};