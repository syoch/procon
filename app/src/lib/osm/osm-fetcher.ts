import { type Boundary } from "./boundary";
import { type OSMFetcher, type OverpassEndpointFetcher } from "./types";
import { env } from "$env/dynamic/private";
import { mergeOSMData } from "./osm-data";
import { routeBoundaries, selfHostedConfig } from "./endpoint-routing";

/**
 * 外部ミラー。カバレッジの外のセルはここへ送る。
 * `OSM_SELF_HOSTED_ENDPOINT` が未設定でも、これまでどおりここだけを使う。
 */
function getFallbackEndpoint(): string {
  const endpoint = env.OVERPASS_ENDPOINT;
  if (!endpoint) {
    throw new Error("OVERPASS_ENDPOINT 環境変数が設定されていません");
  }
  return endpoint;
}

function buildQuery(boundaries: Boundary[]): string {
  let queryRequireSet = "";
  for (const boundary of boundaries) {
    // 生に近いデータのキャッシュを取りたいので、最低限のフィルタで取得する
    // ここでは道を取得しておきたいので highway タグを持つ way を取得する
    queryRequireSet += `way["highway"](${boundary.minLat},${boundary.minLng},${boundary.maxLat},${boundary.maxLng});`;
  }
  return `
  [out:json][timeout:30];
  (
    ${queryRequireSet}
    );
    out body;
    >;
    out skel qt;
    `;
}

/**
 * 与えられた endpoint へ 1 クエリ投げる。**env も coverage も見ない。**
 *
 * 失敗はすべて throw に揃える。5xx も `remark` も失敗として扱う。
 * ルーティング層が endpoint を決めて呼ぶ。テストから差し替えられる。
 */
export const fetchOverpassData: OverpassEndpointFetcher = async function (
  endpoint: string,
  boundaries: Boundary[],
): Promise<App.OSMData> {
  const query = buildQuery(boundaries);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "NITNC-widenavi/1.0 (+https://github.com/syoch/procon)"
    },
    body: "data=" + encodeURIComponent(query),
  });

  if (!res.ok) {
    console.error(`Overpass API エラー: ${res.status} ${res.statusText} (${endpoint})`);
    res.text().then(text => console.error(`レスポンス: ${text}`));
    console.error(`クエリ: ${query}`);
    throw new Error(`Overpass API エラー: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();

  /**
   * Overpass はエラーを HTTP status で伝えず、`remark` として返す (status は 200 のまま)。
   * このクエリは `out` 文が 2 つあるので、`out body` で way が写出された後に
   * `>` や 2 つ目の `out` が timeout/OOM になると、要素が一部だけ入ったまま
   * `remark` が付く。実測でも ways=7008 / nodes=0 + remark のような応答が得られる。
   *
   * これをそのまま返すと欠けたデータがキャッシュに保存され、mtime が更新されて
   * TTL が解けるため、不完全な地図が TTL の間そのまま使われる。失敗として扱う。
   */
  if (typeof data.remark === "string") {
    console.error(`Overpass API エラー (remark): ${data.remark} (${endpoint})`);
    console.error(`クエリ: ${query}`);
    throw new Error(`Overpass API エラー: ${data.remark}`);
  }

  return data;
};

/**
 * セル単位で自前 Overpass と外部ミラーを振り分ける取得を作る。
 *
 * 1. カバレッジ内のセルは `OSM_SELF_HOSTED_ENDPOINT` へ
 * 2. 外のセルは `OVERPASS_ENDPOINT` へ
 * 3. 混在すれば 2 回に分けて `mergeOSMData` で結合
 * 4. 自前が throw したら、そのグループだけ外部へ再送
 *
 * **カバレッジ内から返った空は「本当に空」としてそのまま返す。**
 * 外部へ再送すると、DB の外を空としてキャッシュする失敗模式になる。
 * 再送の条件は「失敗」であって「空」ではない。
 *
 * 低レベルの `fetch` を注入できる。テストは偽の fetcher を渡して
 * `(endpoint, boundaries)` の呼び出しを観測する。
 */
export function createOverpassFetcher(fetch: OverpassEndpointFetcher): OSMFetcher {
  return async function fetchOverpassRouted(boundaries: Boundary[]): Promise<App.OSMData> {
    const selfHosted = selfHostedConfig();
    const fallbackEndpoint = getFallbackEndpoint();

    if (selfHosted === null) {
      return fetch(fallbackEndpoint, boundaries);
    }

    const { selfHosted: inside, fallback: outside } = routeBoundaries(boundaries, selfHosted.coverage);
    console.log(
      `fetchOverpassData: self=${inside.length} fallback=${outside.length} boundaries=${JSON.stringify(boundaries)}`,
    );

    const chunks: App.OSMData[] = [];

    if (inside.length > 0) {
      try {
        chunks.push(await fetch(selfHosted.endpoint, inside));
      } catch (error) {
        // 自前の障害はそのグループだけ外部へ回す。カバレッジ内の空は失敗ではないので
        // ここには来ない (来るのは 5xx / timeout / remark)
        console.warn(`自前 Overpass が失敗したため外部へ再送します (${inside.length} 領域)`, error);
        chunks.push(await fetch(fallbackEndpoint, inside));
      }
    }

    if (outside.length > 0) {
      chunks.push(await fetch(fallbackEndpoint, outside));
    }

    if (chunks.length === 1) {
      return chunks[0];
    }

    const merged: App.OSMData = { elements: [] };
    mergeOSMData(merged, ...chunks);
    return merged;
  };
}

/** 既定のルーティング層。`requireOSMData` に注入される */
export const overpassFetcher: OSMFetcher = createOverpassFetcher(fetchOverpassData);