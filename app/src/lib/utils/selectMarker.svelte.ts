import L from "leaflet";

export class SelectMarker {
	private point = $state<App.Coordinate | null>(null);
	private marker: L.Marker | null = null;

	constructor(map: L.Map) {
		$effect(() => {
			if (!this.point) return;
			if (this.marker) {
				this.marker.remove();
			}
			this.marker = L.marker([
				this.point.lat,
				this.point.lng,
			])
				.addTo(map)
				.bindPopup(
					`Projected Node at ${this.point.lat}, ${this.point.lng}`,
				);

			// 破棄時（親 effect の再実行・コンポーネントのアンマウント）に
			// 地図へ残ったマーカーを取り除く
			return () => {
				this.marker?.remove();
				this.marker = null;
			};
		});
	}

	public setCoordinate(
		point: App.Coordinate,
	) {
		this.point = point;
	}

	public moveFrom(other: SelectMarker) {
		if (this.marker) {
			this.marker.remove();
		}

		this.point = other.point;
		this.marker = other.marker;

		other.marker = null;
		other.point = null;
	}
}