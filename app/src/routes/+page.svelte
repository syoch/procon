<script>
  import { onMount } from "svelte";
  import L from "leaflet";
  import DebugNodeIn from "$lib/ui/debug_node_in.svelte";
  import DebugParam from "$lib/ui/debug_param.svelte";
  import LocationInput from "$lib/ui/location_input.svelte";
  import { loadDebugMap } from "$lib/map_loader/debug";
  import { CalculateCost } from "$lib/cost_calculator";//追加

  /** @type {L.Map} */
  let map;

  onMount(() => {
    const debugMap = loadDebugMap();

    //追加
    Object.values(debugMap.edges).forEach(edge=>{
      CalculateCost(edge);
    });

    map = L.map("map").setView([37.4379, 138.8795], 18);

    // タイルレイヤの追加
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    let i = 0;
    for (const edge of Object.values(debugMap.edges)) {
      const fromNode = debugMap.nodes[edge.begin];
      const toNode = debugMap.nodes[edge.end];

      if (fromNode && toNode) {
        L.polyline(
          [
            [fromNode.coordinate.lat, fromNode.coordinate.lng],
            [toNode.coordinate.lat, toNode.coordinate.lng],
          ],
          { color: i++ % 2 === 0 ? "blue" : "red" },
        )
          .addTo(map)
          .bindPopup(`Edge ID: ${edge.id}`);
      }
    }

    return () => {
      map.remove();
    };
  });
</script>

<div id="map"></div>
<div id="float-actions">
  <div id="DebugNodeIn">
    <DebugNodeIn></DebugNodeIn>
  </div>
  <div id="DebugParam">
    <DebugParam></DebugParam>
  </div>
  <div id="LocationInput">
    <LocationInput></LocationInput><br>
    <input type="text" style="width:80px;" name="start">
    <input type="text" style="width:80px;" name="finish">
    <input type="submit" value="決定">
  </div>
</div>

<style>
  #map {
    height: 100vh;
    width: 100vw;
    position: absolute;
    top: 0;
    left: 0;
    z-index: 0;
  }
  #float-actions {
    position: absolute;
    bottom: 10px;
    left: 10px;
    background-color: rgba(255, 255, 255, 0.7);
    border-radius: 10px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);

    div {
      margin: 10px;
    }

    div:nth-child(n + 2) {
      padding-top: 10px;
      border-top: 1px solid #ccc;
    }
  }
</style>
