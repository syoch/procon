import { divideBoundary, simplifyBoundary as simplifyBoundaries, type Boundary } from "./boundary";
import { readCache, saveCache } from "./cache-manager";
import { mergeOSMData, trimOSMData, type OSMData } from "./osmdata";
import { env } from "$env/dynamic/private";

function getOverpassEndpoint(): string {
  const endpoint = env.OVERPASS_ENDPOINT;
  if (!endpoint) {
    throw new Error("OVERPASS_ENDPOINT 環境変数が設定されていません");
  }
  return endpoint;
}

async function fetchOverpassData(boundaries: Boundary[]): Promise<OSMData> {
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

export async function requireOSMData(boundary: Boundary): Promise<OSMData> {
  const dividedBoundaries = divideBoundary(boundary);

  const boundariesToGet: Boundary[] = [];
  const cachedChunks: OSMData[] = [];
  for (const b of dividedBoundaries) {
    try {
      cachedChunks.push(await readCache(b));
    } catch (e) {
      if ((e as any).code === "ENOENT") {
        boundariesToGet.push(b);
      } else {
        throw e;
      }
    }
  }

  if (boundariesToGet.length > 0) {
    const boundariesToQuery = simplifyBoundaries(boundariesToGet);
    const fetchedData = await fetchOverpassData(boundariesToQuery);

    for (const b of boundariesToGet) {
      const subData = trimOSMData(fetchedData, b);
      await saveCache(b, subData);
      cachedChunks.push(subData);
    }
  }

  const mergedData: OSMData = { elements: [] };
  for (const chunk of cachedChunks) {
    mergeOSMData(mergedData, chunk);
  }

  return trimOSMData(mergedData, boundary);
}
