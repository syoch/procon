import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getRequests } from '$lib/tracing/database.server';

export const GET: RequestHandler = async ({ request }) => {
    const url = new URL(request.url);
    const bootId = url.searchParams.get("b");
    const sortParam = url.searchParams.get("s");
    const sort = sortParam === "asc" ? "asc" : sortParam === "desc" ? "desc" : undefined;

    return json(getRequests(bootId === null ? undefined : bootId, sort));
};
