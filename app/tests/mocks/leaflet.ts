// Node 上で Leaflet 依存モジュールを動かすための最小スタブ。
// 距離計算 (Haversine) だけを提供する。テストから vi.mock("leaflet", ...) で差し替える。
const R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

export class LatLng {
  constructor(
    public lat: number,
    public lng: number,
  ) {}

  distanceTo(other: { lat: number; lng: number }): number {
    const dLat = toRad(other.lat - this.lat);
    const dLng = toRad(other.lng - this.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(this.lat)) * Math.cos(toRad(other.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }
}

export function latLng(lat: number, lng: number): LatLng {
  return new LatLng(lat, lng);
}

export default { LatLng, latLng };
