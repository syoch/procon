import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import type { Boundary } from '../../../osm-cache/boundary';
import { requireOSMData } from '../../../osm-cache';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json() as Boundary;
    return json(await requireOSMData(body));
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  }
};