import { env } from "$env/dynamic/private";
import { GSI_TILE_ZOOM, type GsiTileFetcher } from ".";

/** 国土地理院 道路中心線タイルの URL (環境変数 GSI_ROAD_TILE_URL で差し替え可能) */
const DEFAULT_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/experimental_rdcl/{z}/{x}/{y}.geojson";
/**
 * タイル 1 枚の取得のタイムアウト [ms] (仮の値)
 * 国土地理院側が応答しないまま接続を保持した場合に、探索全体が止まらないようにする (実測では 1 枚 100ms 程度)
 */
const FETCH_TIMEOUT_MS = 10_000;

export const fetchGsiRoadTile: GsiTileFetcher = async function (tile) {
  const url = (env.GSI_ROAD_TILE_URL || DEFAULT_TILE_URL)
    .replace("{z}", String(GSI_TILE_ZOOM))
    .replace("{x}", String(tile.x))
    .replace("{y}", String(tile.y));

  const res = await fetch(url, {
    headers: { "User-Agent": "NITNC-widenavi/1.0 (+https://github.com/syoch/procon)" },
    // 本文 (res.json()) の受信にもこのタイムアウトが効く
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  // 道路が無い地域 (海上など) のタイルは存在しない
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`国土地理院タイル取得エラー: ${res.status} ${res.statusText}`);
  }
  return await res.json();
};
