<script lang="ts">
  import { onMount } from "svelte";
  import L from "leaflet";
  import type { SharpTurn } from "$lib/sharp_turn";

  let {
    map = $bindable(),
    pathResult = $bindable(),
    sharpTurns = [],
    onClick,
  }: {
    map: L.Map | undefined;
    pathResult: App.Coordinate[];
    /** 経路上の急カーブ (マーカーで表示する。急カーブは赤、注意はオレンジ) */
    sharpTurns?: SharpTurn[];
    onClick: (lat: number, lng: number) => void;
  } = $props();

  $effect(() => {
    if (!map) {
      return;
    }

    map.eachLayer((layer) => {
      if (!map) return;
      if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

    if (pathResult.length > 0) {
      L.polyline(pathResult, { color: "purple", weight: 5 })
        .addTo(map)
        .bindPopup(`Found path with ${pathResult.length} nodes`);
    }

    // 急カーブをマーカーで表示する (見た目は仮)
    // 危険度で色を分ける: 急カーブ (sharp) は赤、注意 (caution) はオレンジ
    for (const turn of sharpTurns) {
      const isSharp = turn.level === "sharp";
      L.circleMarker([turn.coordinate.lat, turn.coordinate.lng], {
        color: isSharp ? "darkred" : "orangered",
        fillColor: isSharp ? "red" : "orange",
        fillOpacity: 0.9,
        radius: isSharp ? 8 : 6,
      })
        .addTo(map)
        .bindPopup(
          `${isSharp ? "急カーブ" : "注意カーブ"}(${turn.direction === "left" ? "左" : "右"}) 約${Math.round(turn.angle)}° / 半径 約${Math.round(turn.radius)}m (${turn.highway})`,
        );
    }
  });

  onMount(() => {
    map = L.map("map", { zoomControl: false })
      .setView([34.350683, 134.046939], 18)
      .on("click", function (e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        onClick(lat, lng);
      });

    // タイルレイヤの追加
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      // 経路探索では道路の幅員に国土地理院の道路中心線 (提供実験) を使っているため、出典を併記する
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors' +
        ' | 道路幅員: <a href="https://github.com/gsi-cyberjapan/experimental_rdcl">国土地理院</a>',
      maxZoom: 18,
    }).addTo(map);

    return () => {
      if (!map) return;
      map.remove();
    };
  });
</script>

<div id="map"></div>

<style>
  #map {
    height: 100vh;
    width: 100vw;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 0;
  }
</style>
