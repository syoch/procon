// src/routes/api/location/+server.ts
//
// 地名・施設名の検索クエリを受け取り、座標と地名候補の一覧を返すAPI。
// 実体はNominatim(OSM公式ジオコーディングAPI, nominatim.openstreetmap.org)へのサーバーサイドプロキシ。
//
// [!] 本番デプロイ前に要対応:
//   1. 下のUser-Agentの連絡先(https://github.com/TODO-set-repo-url-here の部分)を
//      実際のチームのリポジトリURLかメールアドレスに差し替える(半角英数字のみ。全角文字はNG)
//   2. adapter-staticのままだとビルドできないので、デプロイ先に合わせてアダプタを変更する
//   3. フロント側の呼び出しは「1文字入力ごとにfetch」しないこと(デバウンス必須。ポリシーで明示的に禁止されてる)
//   4. 検索結果を画面に出す際は "© OpenStreetMap contributors" のクレジット表示が必要
//
// 参考: Nominatim Usage Policy https://operations.osmfoundation.org/policies/nominatim/
//       Nominatim Search API   https://nominatim.org/release-docs/latest/api/Search/

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * 検索結果1件分(フロントに返す形)
 * @typedef {Object} LocationCandidate
 * @property {string} name - 短い表示名(例: "長岡駅")
 * @property {string} displayName - Nominatimの完全な住所文字列
 * @property {number} lat - 緯度
 * @property {number} lon - 経度
 * @property {string} category - OSMのclassタグ(例: "railway", "amenity")
 * @property {string} type - OSMのtypeタグ(例: "station", "school")
 * @property {[number, number, number, number]} boundingBox - [minLat, maxLat, minLon, maxLon]
 */

/** Nominatimのjsonv2レスポンス1件分(必要なフィールドのみ) */
interface NominatimResult {
	lat: string;
	lon: string;
	display_name: string;
	name?: string;
	class: string;
	type: string;
	boundingbox: [string, string, string, string];
}

interface LocationCandidate {
	name: string;
	displayName: string;
	lat: number;
	lon: number;
	category: string;
	type: string;
	boundingBox: [number, number, number, number];
}

const NOMINATIM_ENDPOINT = 'https://nominatim.openstreetmap.org/search';

// Nominatim利用ポリシー: 公開サーバーへは1リクエスト/秒が絶対上限。
// 少し余裕を持たせて1.1秒間隔にしておく。
const MIN_REQUEST_INTERVAL_MS = 1100;
let lastUpstreamRequestAt = 0;
let upstreamQueue: Promise<unknown> = Promise.resolve();

// 同じクエリを叩き直さないための簡易キャッシュ(プロセスメモリ上のみ、再起動で消える)
const CACHE_TTL_MS = 10 * 60 * 1000; // 10分
const searchCache = new Map<string, { data: LocationCandidate[]; expiresAt: number }>();

/**
 * Nominatimへのリクエストを1req/秒に間引きながら直列実行するキュー。
 * 同時に複数ユーザーが検索しても、実際にNominatimへ飛ぶのは最短1.1秒間隔になる。
 */
function enqueueUpstreamRequest<T>(task: () => Promise<T>): Promise<T> {
	const run = upstreamQueue.then(async () => {
		const wait = MIN_REQUEST_INTERVAL_MS - (Date.now() - lastUpstreamRequestAt);
		if (wait > 0) {
			await new Promise((resolve) => setTimeout(resolve, wait));
		}
		lastUpstreamRequestAt = Date.now();
		return task();
	});
	upstreamQueue = run.catch(() => undefined); // キューが例外で詰まらないように
	return run;
}

/**
 * Nominatimへ実際にリクエストを送る。成功時はResponseを返し、
 * 失敗時は必ずthrowする(呼び出し元に「何も返さない経路」を作らないための切り出し)。
 */
async function fetchFromNominatim(nominatimUrl: URL, fetchFn: typeof fetch): Promise<Response> {
	try {
		return await enqueueUpstreamRequest(() =>
			fetchFn(nominatimUrl, {
				headers: {
					// 半角英数字のみ。日本語などの全角文字を入れるとfetch()が例外を投げるので注意
					'User-Agent': 'procon-safe-nav/0.1 (+https://github.com/TODO-set-repo-url-here)'
				}
			})
		);
	} catch (e) {
		console.error('[api/location] Nominatimへのリクエストに失敗', e);
		throw error(502, '位置情報サービスへの接続に失敗しました');
	}
}

export const GET: RequestHandler = async ({ url, fetch }) => {
	const q = url.searchParams.get('q')?.trim() ?? '';
	const limitParam = Number(url.searchParams.get('limit') ?? '5');
	const limit = Number.isFinite(limitParam)
		? Math.min(Math.max(Math.trunc(limitParam), 1), 10)
		: 5;

	// 短すぎるクエリは候補として意味がない上にNominatimへの無駄打ちになるので弾く
	if (q.length < 2) {
		throw error(400, 'q パラメータは2文字以上で指定してください');
	}

	const cacheKey = `${q}::${limit}`;
	const cached = searchCache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return json({ candidates: cached.data, cached: true });
	}

	const nominatimUrl = new URL(NOMINATIM_ENDPOINT);
	nominatimUrl.searchParams.set('q', q);
	nominatimUrl.searchParams.set('format', 'jsonv2');
	nominatimUrl.searchParams.set('limit', String(limit));
	nominatimUrl.searchParams.set('countrycodes', 'jp'); // 検索範囲: 日本国内限定
	nominatimUrl.searchParams.set('accept-language', 'ja');

	const upstreamResponse = await fetchFromNominatim(nominatimUrl, fetch);

	if (!upstreamResponse.ok) {
		console.error('[api/location] Nominatimがエラーを返却', upstreamResponse.status);
		throw error(502, `位置情報サービスがエラーを返しました(status: ${upstreamResponse.status})`);
	}

	const raw = (await upstreamResponse.json()) as NominatimResult[];

	const candidates: LocationCandidate[] = raw.map((r) => ({
		name: r.name?.trim() || r.display_name.split(',')[0].trim(),
		displayName: r.display_name,
		lat: Number(r.lat),
		lon: Number(r.lon),
		category: r.class,
		type: r.type,
		boundingBox: [
			Number(r.boundingbox[0]),
			Number(r.boundingbox[1]),
			Number(r.boundingbox[2]),
			Number(r.boundingbox[3])
		]
	}));

	searchCache.set(cacheKey, { data: candidates, expiresAt: Date.now() + CACHE_TTL_MS });

	return json({ candidates, cached: false });
};