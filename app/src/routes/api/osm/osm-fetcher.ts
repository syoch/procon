import { type Boundary } from "./boundary";
import { type OSMData } from "./osm-data";
import { type OSMFetcher } from ".";
import { env } from "$env/dynamic/private";

function getOverpassEndpoint(): string {
  const endpoint = env.OVERPASS_ENDPOINT;
  if (!endpoint) {
    throw new Error("OVERPASS_ENDPOINT 環境変数が設定されていません");
  }
  return endpoint;
}

export const fetchOverpassData: OSMFetcher = async function (boundaries: Boundary[]): Promise<OSMData> {
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

  return await res.json();
}