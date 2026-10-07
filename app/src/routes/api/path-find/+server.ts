import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

import { z } from 'zod';
import { doPathFind } from './pathFind';
import { MODE_IDS, MODE_PROFILES } from '$lib/mode_profiles';
import type { ModeId } from '$lib/mode_rules';
import { RequestContext } from '$lib/tracing/requestContext';



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

// トレースに残すフィールドを明示する。スキーマに機微な値が増えても保存しない。
function describeRequest(req: z.infer<typeof requestSchema>): string {
    const fields = [
        `begin=${JSON.stringify(req.begin)}`,
        `end=${JSON.stringify(req.end)}`,
        `parameters=${JSON.stringify(req.parameters)}`,
    ];
    if ("mode" in req) {
        fields.push(`mode=${req.mode}`);
    }
    if ("wayHighway" in req) {
        fields.push(`wayHighway=${JSON.stringify(req.wayHighway)}`);
    }
    return fields.join(" ");
}

export const POST: RequestHandler = async ({ request }) => {
    const requestedAt = new Date();
    const perfCtx = new RequestContext(requestedAt, "POST", request.url);
    try {
        const body = await request.json();
        const query = requestSchema.safeParse(body);
        if (!query.success) {
            return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
        }
        const req = query.data;
        perfCtx.log(`request: ${describeRequest(req)}`);

        const res = "mode" in req
            ? await doPathFind(perfCtx, req.begin, req.end, req.parameters ?? MODE_PROFILES[req.mode].defaultParameters, [], req.mode)
            : await doPathFind(perfCtx, req.begin, req.end, req.parameters, req.wayHighway);


        return json(res)
    } catch (error) {
        perfCtx.logError(error);
        throw error;
    } finally {
        perfCtx.endMeasurement();
    }
};
