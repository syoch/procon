import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getBoots } from '$lib/tracing/database.server';

export const GET: RequestHandler = async ({ request }) => {
    const url = new URL(request.url);
    const sortParam = url.searchParams.get("s");
    const sort = sortParam === "asc" ? "asc" : sortParam === "desc" ? "desc" : undefined;
    return json(getBoots(sort));
};
