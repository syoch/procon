import { type Boundary } from "./boundary";
import { type OSMFetcher } from "./types";
import { env } from "$env/dynamic/private";

function getOverpassEndpoint(): string {
  const endpoint = env.OVERPASS_ENDPOINT;
  if (!endpoint) {
    throw new Error("OVERPASS_ENDPOINT 環境変数が設定されていません");
  }
  return endpoint;
}

export const fetchOverpassData: OSMFetcher = async function (boundaries: Boundary[]): Promise<App.OSMData> {
  let queryRequireSet = ""
  for (const boundary of boundaries) {
    // 生に近いデータのキャッシュを取りたいので、最低限のフィルタで取得する
    // ここでは道を取得しておきたいので highway タグを持つ way を取得する
    queryRequireSet += `way["highway"](${boundary.minLat},${boundary.minLng},${boundary.maxLat},${boundary.maxLng});`;
  }
  const query = `
  [out:json][timeout:30];
  (
    ${queryRequireSet}
    );
    out body;
    >;
    out skel qt;
    `;

  console.log(`fetchOverpassData: boundaries=${JSON.stringify(boundaries)}`);
  const res = await fetch(getOverpassEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "NITNC-widenavi/1.0 (+https://github.com/syoch/procon)"
    },
    body: "data=" + encodeURIComponent(query),
  });

  if (!res.ok) {
    console.error(`Overpass API エラー: ${res.status} ${res.statusText}`);
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
    console.error(`Overpass API エラー (remark): ${data.remark}`);
    console.error(`クエリ: ${query}`);
    throw new Error(`Overpass API エラー: ${data.remark}`);
  }

  return data;
}