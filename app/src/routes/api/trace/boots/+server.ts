import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBoots } from '$lib/tracing';

export const GET: RequestHandler = async ({ request }) => {
    return json(getBoots().map(x=>({...x, bootedAt: x.bootedAt.getTime()})));
};
