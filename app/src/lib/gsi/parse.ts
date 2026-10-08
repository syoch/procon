/**
 * 国土地理院「道路中心線」タイルから、幅員の分かる車道の区間を取り出す
 *
 * 出典: 国土地理院 地図情報 (道路中心線) ベクトルタイル提供実験
 *       https://github.com/gsi-cyberjapan/experimental_rdcl
 */

/** 国土地理院の道路中心線の 1 区間 (線を頂点ごとに分解したもの) */
export type GsiRoadSegment = {
  begin: App.Coordinate;
  end: App.Coordinate;
  /** 幅員区分の代表値 [m] */
  width: number;
};

/**
 * 幅員区分 (rnkWidth) → 区分の中の代表値 [m]
 * 区分の境界 (3m / 5.5m / 13m / 19.5m) をまたがない値にしている
 */
const WIDTH_CLASS_TO_METERS: Record<string, number> = {
  "3m未満": 2.0,
  "3m-5.5m未満": 4.0,
  "5.5m-13m未満": 8.0,
  "13m-19.5m未満": 15.0,
  "19.5m以上": 20.0,
};

/** 幅員区分の文字列を代表値 [m] に直す (不明な区分は undefined) */
export function widthClassToMeters(rnkWidth: unknown): number | undefined {
  return typeof rnkWidth === "string" ? WIDTH_CLASS_TO_METERS[rnkWidth] : undefined;
}

/**
 * 国土地理院の GeoJSON タイルから、幅員の分かる車道の区間を取り出す
 *
 * @param geojson 道路中心線タイル (FeatureCollection)
 */
export function parseGsiRoadTile(geojson: unknown): GsiRoadSegment[] {
  const features = (geojson as { features?: unknown[] })?.features ?? [];
  const result: GsiRoadSegment[] = [];
  for (const feature of features as { geometry?: { type?: string; coordinates?: number[][] }; properties?: Record<string, unknown> }[]) {
    // 車道 (通常部) だけを使う。庭園路 (公園・工場内) や徒歩道の幅員は車道に移さない
    if (feature.properties?.type !== "通常部") continue;
    if (feature.geometry?.type !== "LineString") continue;
    const width = widthClassToMeters(feature.properties?.rnkWidth);
    if (width === undefined) continue;

    const coords = feature.geometry.coordinates ?? [];
    for (let i = 0; i < coords.length - 1; i++) {
      result.push({
        begin: { lat: coords[i][1], lng: coords[i][0] },
        end: { lat: coords[i + 1][1], lng: coords[i + 1][0] },
        width,
      });
    }
  }
  return result;
}
