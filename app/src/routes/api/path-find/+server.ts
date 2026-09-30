import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { z } from 'zod';
import { doPathFind, PathFindError } from './pathFind';
import { MODE_IDS, MODE_PROFILES, type ModeId } from '$lib/mode_profiles';

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
// mode を指定した場合、parameters と wayHighway は省略できる
// (parameters 省略時はモードの既定値、wayHighway はモードのルールで置き換わる)。
// mode を指定しない場合は従来どおり parameters と wayHighway が必須。
const requestSchema = z.object({
    begin: coordinateSchema,
    end: coordinateSchema,
    parameters: paramsSchema.optional(),
    wayHighway: z.array(z.string()).optional(),
    mode: z.enum(MODE_IDS as [ModeId, ...ModeId[]]).optional(),
}).refine(
    (req) => req.mode !== undefined || (req.parameters !== undefined && req.wayHighway !== undefined),
    { message: "mode を指定しない場合は parameters と wayHighway が必要です" },
);

export const POST: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
        return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }
    const { begin, end, mode } = query.data;
    const parameters = query.data.parameters ?? MODE_PROFILES[mode!].defaultParameters;
    let res;
    try {
        res = await doPathFind(begin, end, parameters, query.data.wayHighway ?? [], mode);
    } catch (e) {
        // 到達できない場合などは、理由をユーザーに伝えられるよう 422 とメッセージを返す
        if (e instanceof PathFindError) {
            return json({ error: e.message, code: e.code }, { status: 422 });
        }
        throw e;
    }

    return json(res)
};
