import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBoots } from '$lib/tracing/database.server';

export const GET: RequestHandler = async ({ request }) => {
    return json(getBoots());
};
