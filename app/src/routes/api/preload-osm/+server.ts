import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { z } from 'zod';
import { cacheManager } from '$lib/osm/fs-cache-manager';
import { overpassFetcher } from '$lib/osm/osm-fetcher';
import { requireOSMData, OSMCellLimitError } from '$lib/osm';
import { divideBoundary, simplifyBoundaries } from '$lib/osm/boundary';
import { routeBoundaries, selfHostedConfig } from '$lib/osm/endpoint-routing';
import { getBoundaryBox } from '$lib/osm/path-boundary';
import { RequestContext } from '$lib/tracing/requestContext';

const coordinateSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});
// 端点先読み。end が無いときは begin の周辺だけを温める
const requestSchema = z.object({
  begin: coordinateSchema,
  end: coordinateSchema.optional(),
});
export const POST: RequestHandler = async ({ request }) => {
  const requestedAt = new Date();
  const reqCtx = new RequestContext(requestedAt, "POST", request.url);
  try {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
      return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }
    // 経路探索が読む範囲と同じ範囲を温める
    const { begin, end } = query.data;
    const bbox = getBoundaryBox(begin, end ?? begin);
    reqCtx.log(`boundary: minLat=${bbox.minLat} minLng=${bbox.minLng} maxLat=${bbox.maxLat} maxLng=${bbox.maxLng}`);

    const config = selfHostedConfig();
    if (config === null) {
      // ルーティングが無効なら現行どおり全部を温める
      await requireOSMData(reqCtx, bbox, cacheManager, overpassFetcher, true);
      return json({ success: true });
    }

    // 自前が担当するセル (完全にカバレッジ内) は先読みしない。
    // 自前は live で返し、その結果はキャッシュしないので、温めても捨てられる
    const { fallback } = routeBoundaries(divideBoundary(bbox), config.coverage);
    if (fallback.length === 0) {
      // 全部カバレッジ内。フェッチ 0 件でも成功
      return json({ success: true });
    }

    // 外部が担当するセルだけを、まとめた矩形ごとに温める
    for (const rect of simplifyBoundaries(fallback)) {
      await requireOSMData(reqCtx, rect, cacheManager, overpassFetcher, true);
    }

    return json({ success: true });
  } catch (error) {
    reqCtx.logError(error);
    // 範囲が広すぎるのはクライアントの指定の問題。500 ではなく 4xx で返す
    if (error instanceof OSMCellLimitError) {
      return json({ error: error.message }, { status: 422 });
    }
    console.error(error);
    return json({ error: 'Failed to fetch OSM data' }, { status: 500 });
  } finally {
    reqCtx.endMeasurement();
  }
};