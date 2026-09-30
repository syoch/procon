const R = 6378137; // 地球の赤道半径

/** 度 → ラジアン (App.Coordinate の lat / lng は度単位) */
const toRadian = (degree: number) => degree * Math.PI / 180;

/**
 * 2 点間の距離 [m] (haversine の公式)
 */
export function distanceOf(begin: App.Coordinate, end: App.Coordinate) {
  const sin_deltaLat_2 = Math.sin(toRadian(begin.lat - end.lat) / 2);
  const sin_deltaLng_2 = Math.sin(toRadian(begin.lng - end.lng) / 2);
  const cos_lat1 = Math.cos(toRadian(begin.lat));
  const cos_lat2 = Math.cos(toRadian(end.lat));
  return 2 * R * Math.asin(Math.sqrt(
    sin_deltaLat_2 * sin_deltaLat_2 + cos_lat1 * cos_lat2 * sin_deltaLng_2 * sin_deltaLng_2
  ));
}