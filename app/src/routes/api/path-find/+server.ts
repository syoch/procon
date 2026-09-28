import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { z } from 'zod';
import { doPathFind } from './pathFind';

const coordinateSchema = z.object({
    lat: z.number(),
    lng: z.number()
});
const paramsSchema = z.object({
    mix_score_weight: z.number(),
    view_score_weight: z.number(),
    width_score_weight: z.number(),
    lambda: z.number(),
});
const requestSchema = z.object({
    begin: coordinateSchema,
    end: coordinateSchema,
    parameters: paramsSchema,
    wayHighway: z.array(z.string()),
});

export const POST: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
        return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }
    const res = await doPathFind(query.data.begin, query.data.end, query.data.parameters, query.data.wayHighway);

    return json(res)
};
