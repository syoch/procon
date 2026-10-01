import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { z } from 'zod';
import { doPathFind } from './pathFind';
import { MODE_IDS, MODE_PROFILES, type ModeId } from '$lib/mode_profiles';

const coordinateSchema = z.object({
    lat: z.number(),
    lng: z.number()
});
const paramsSchema = z.object({
    mix_score_weight: z.number(),
    view_score_weight: z.number(),
    width_score_weight: z.number(),
    // 安全をどれだけ重視するか (0 で最短。負の値は「危ない道ほど得」になるので許さない)
    lambda: z.number().min(0),
});
// 通れる道の指定は mode と wayHighway のどちらか一方 (両方指定するとどちらが優先か曖昧なので 400 にする)。
// - mode を指定する形式: 通れる道はモードのルールで決まる。parameters は省略でき、省略時はモードの既定値
// - mode を指定しない形式 (従来どおり): parameters と wayHighway が必須
// どちらも未知のキーを許さない (strictObject) ので、mode と wayHighway を両方送るとどちらにも当てはまらず 400 になる
const modeRequestSchema = z.strictObject({
    begin: coordinateSchema,
    end: coordinateSchema,
    mode: z.enum(MODE_IDS as [ModeId, ...ModeId[]]),
    parameters: paramsSchema.optional(),
});
const legacyRequestSchema = z.strictObject({
    begin: coordinateSchema,
    end: coordinateSchema,
    parameters: paramsSchema,
    wayHighway: z.array(z.string()),
});
const requestSchema = z.union([modeRequestSchema, legacyRequestSchema]);

export const POST: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
        return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }
    const req = query.data;
    const res = "mode" in req
        ? await doPathFind(req.begin, req.end, req.parameters ?? MODE_PROFILES[req.mode].defaultParameters, [], req.mode)
        : await doPathFind(req.begin, req.end, req.parameters, req.wayHighway);

    return json(res)
};
