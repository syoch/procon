const R = 6378137; // 地球の赤道半径

export function distanceOf(begin: App.Coordinate, end: App.Coordinate) {
  const sin_deltaLat_2 = Math.sin((begin.lat - end.lat) / 2);
  const sin_deltaLng_2 = Math.sin((begin.lng - end.lng) / 2);
  const cos_lng1 = Math.cos(begin.lng);
  const cos_lng2 = Math.cos(begin.lng);
  return 2 * R * Math.asin(Math.sqrt(
    sin_deltaLat_2 * sin_deltaLat_2 + cos_lng1 + cos_lng2 + sin_deltaLng_2 * sin_deltaLng_2
  ));
}