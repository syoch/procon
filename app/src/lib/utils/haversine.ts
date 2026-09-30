const R = 6378137; // 地球の赤道半径

function degToRad(deg: number) {
  return deg * Math.PI / 180;
}

export function distanceOf(begin: App.Coordinate, end: App.Coordinate) {
  const sin_deltaLat_2 = Math.sin(degToRad(begin.lat - end.lat) / 2);
  const sin_deltaLng_2 = Math.sin(degToRad(begin.lng - end.lng) / 2);
  const cos_lat1 = Math.cos(degToRad(begin.lat));
  const cos_lat2 = Math.cos(degToRad(end.lat));
  return 2 * R * Math.asin(Math.sqrt(
    sin_deltaLat_2 * sin_deltaLat_2 + cos_lat1 * cos_lat2 * sin_deltaLng_2 * sin_deltaLng_2
  ));
} 