import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { refreshExpiredOSMCache, ttlMs } from '$lib/osm/expired-cache';
import { cacheManager, cleanupStaleTempFiles, listCachedOSMCells } from '$lib/osm/fs-cache-manager';
import { overpassFetcher } from '$lib/osm/osm-fetcher';

/**
 * TTL を超えた OSM キャッシュを更新するためのエントリポイント。
 * `procon-cache-refresh.timer` からだけ叩けるよう、nginx が
 * `location ~* ^/api/cache-refresh/?$` で拒否し、ここでもトークンを照合する。
 */
export const POST: RequestHandler = async ({ request }) => {
  const expected = env.PROCON_CACHE_REFRESH_TOKEN;
  if (!expected) {
    // 未設定なら無条件に拒否する。タイマが毎晩失敗して journal に残る
    return json({ error: 'PROCON_CACHE_REFRESH_TOKEN が設定されていません' }, { status: 503 });
  }

  const token = request.headers.get('x-procon-cache-refresh');
  if (token !== expected) {
    return json({ error: '認証に失敗しました' }, { status: 401 });
  }

  try {
    await cleanupStaleTempFiles().catch((e) => console.warn('一時ファイルの掃除に失敗しました', e));

    const result = await refreshExpiredOSMCache(
      listCachedOSMCells,
      overpassFetcher,
      cacheManager.saveCache,
      { ttlMs: ttlMs(env.OSM_CACHE_TTL_DAYS) },
    );

    // 非 2xx にしないと `curl --fail-with-body` が成功扱いになり、Overpass の
    // 障害が systemd 上は「成功」に見える
    if (result.failed > 0) {
      return json(
        { ...result, error: '一部のセルの更新に失敗しました' },
        { status: 500 },
      );
    }
    return json(result);
  } catch (error) {
    console.error(error);
    return json({ error: 'Failed to refresh OSM cache' }, { status: 500 });
  }
};
