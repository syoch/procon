<script>
  import { onMount } from "svelte";
  import L from "leaflet";
  import "leaflet/dist/leaflet.css";

  /** @type {L.Map} */
  let map;

  onMount(() => {
    map = L.map("map").setView([35.658068, 139.751599], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);
    L.polyline(
      [
        [35.658068, 139.751599],
        [35.689487, 139.691706],
        [35.710063, 139.8107],
      ],
      { color: "blue" },
    ).addTo(map);
  });
</script>

<div id="map" style="height: 100vh;"></div>
