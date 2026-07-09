<script>
  import { onMount } from "svelte";
  import L from "leaflet";
  import DebugNodeIn from "$lib/ui/debug_node_in.svelte";
  import DebugParam from "$lib/ui/debug_param.svelte";
  import LocationInput from "$lib/ui/location_input.svelte";
  import { loadDebugMap } from "$lib/map_loader/debug";
  import { watch } from "runed";

  /** @type {L.Map} */
  let map;

  /** @type {L.Marker | null} */
  let selected_node_marker = null;

  /** @type {App.NodeId | null} */
  let selected_node_id = $state(null);

  /** @type {App.NodeId | null} */
  let begin_node_id = $state(null);

  /** @type {App.NodeId | null} */
  let end_node_id = $state(null);

  watch(
    () => begin_node_id,
    (newBeginNodeId) => {
      console.log("Begin node ID changed:", newBeginNodeId);
    },
  );

  onMount(() => {
    const debugMap = loadDebugMap();

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

    map.on("click", function (e) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;

      const nodeId = Object.values(debugMap.nodes).toSorted((a, b) => {
        const aDistance = Math.sqrt(
          Math.pow(a.coordinate.lat - lat, 2) +
            Math.pow(a.coordinate.lng - lng, 2),
        );
        const bDistance = Math.sqrt(
          Math.pow(b.coordinate.lat - lat, 2) +
            Math.pow(b.coordinate.lng - lng, 2),
        );
        return aDistance - bDistance;
      })[0].id;
      const node = debugMap.nodes[nodeId];

      if (selected_node_marker) {
        map.removeLayer(selected_node_marker);
      }

      selected_node_id = nodeId;
      selected_node_marker = L.marker([
        node.coordinate.lat,
        node.coordinate.lng,
      ])
        .bindPopup(
          `NodeId: ${nodeId}<br>緯度: ${node.coordinate.lat}<br>経度: ${node.coordinate.lng}`,
        )
        .addTo(map);
    });

    return () => {
      map.remove();
    };
  });
</script>

<div id="map"></div>
<div id="float-actions">
  <div id="DebugNodeIn">
    <DebugNodeIn {selected_node_id} {begin_node_id} {end_node_id}></DebugNodeIn>
  </div>
  <div id="DebugParam">
    <DebugParam></DebugParam>
  </div>
  <div id="LocationInput">
    <LocationInput></LocationInput>
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
