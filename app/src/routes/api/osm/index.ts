import { divideBoundary, simplifyBoundary, type Boundary } from "./boundary";
import { readCache, saveCache } from "./cache-manger";
import { mergeOSMData, trimOSMData, type OSMData } from "./osmdata";

const OVERPASS_ENDPOINT = "https://overpass.openstreetmap.fr/api/interpreter";

async function fetchOverpassData(boundaries: Boundary[]): Promise<OSMData> {
  let queryRequireSet = ""
  for (const boundary of boundaries) {
    // 生に近いデータのキャッシュを取りたいので、 bbox 以外のフィルタは使わない
    queryRequireSet += `way(${boundary.minLat},${boundary.minLng},${boundary.maxLat},${boundary.maxLng});`;
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

  const res = await fetch(OVERPASS_ENDPOINT, {
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
    const boundariesToQuery = simplifyBoundary(boundariesToGet);
    const fetchedData = await fetchOverpassData(boundariesToQuery);

    for (const b of boundariesToGet) {
      const subData = trimOSMData(fetchedData, b);
      saveCache(b, subData);
      cachedChunks.push(subData);
    }
  }

  const mergedData: OSMData = { elements: [] };
  for (const chunk of cachedChunks) {
    mergeOSMData(mergedData, chunk);
  }

  return trimOSMData(mergedData, boundary);
}
