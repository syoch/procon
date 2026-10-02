import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRequests } from '$lib/tracing/database.server';

export const GET: RequestHandler = async ({ request }) => {
    const url = new URL(request.url);
    const bootId = url.searchParams.get("b");

    return json(getRequests(bootId === null ? undefined : bootId));
};
