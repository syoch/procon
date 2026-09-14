<script lang="ts">
  import { onMount } from "svelte";
  import L from "leaflet";
  import DebugNodeIn from "$lib/ui/debug_node_in.svelte";
  import DebugParam from "$lib/ui/debug_param.svelte";
  import LocationInput from "$lib/ui/location_input.svelte";
  import { loadDebugMap } from "$lib/map_loader/debug";
  import ConsoleLogHook from "$lib/ui/console_log_hook.svelte";

  let map: L.Map;

  class SelectMarker {
    marker: L.Marker;
    node_id: App.NodeId;

    constructor(marker: L.Marker, node_id: App.NodeId) {
      this.marker = marker;
      this.node_id = node_id;
    }

    dispose() {
      console.log(`Disposing marker for node ${this.node_id}`);
      map.removeLayer(this.marker);
    }

    toString() {
      return `Node<${this.node_id}>`;
    }
  }

  let selected_node_marker: SelectMarker | null = $state(null);
  let begin_node_marker: SelectMarker | null = $state(null);
  let end_node_marker: SelectMarker | null = $state(null);
  let consoleLogBuf: ConsoleLogHook;

  $effect(() => {
    if (begin_node_marker && end_node_marker) {
      console.log(
        `Selected path: ${begin_node_marker.node_id} -> ${end_node_marker.node_id}`,
      );
    }
  });

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
        selected_node_marker.dispose();
      }
      selected_node_marker = new SelectMarker(
        L.marker([node.coordinate.lat, node.coordinate.lng])
          .addTo(map)
          .bindPopup(`Node ID: ${node.id}`),
        node.id,
      );
    });

    consoleLogBuf.patch_console_log();
    return () => {
      map.remove();
    };
  });
</script>

<div id="map"></div>

<div id="float-actions">
  <div id="DebugNodeIn">
    <DebugNodeIn
      bind:selected_node_id={selected_node_marker}
      bind:begin_node_id={begin_node_marker}
      bind:end_node_id={end_node_marker}
    ></DebugNodeIn>
  </div>
  <div id="DebugParam">
    <DebugParam></DebugParam>
  </div>
  <div id="LocationInput">
    <LocationInput></LocationInput>
  </div>
</div>

<div id="debug-log">
  <ConsoleLogHook bind:this={consoleLogBuf}></ConsoleLogHook>
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

  #debug-log {
    position: absolute;
    bottom: 10px;
    right: 10px;
    background-color: rgba(0, 0, 0, 0.6);
    color: rgba(255, 255, 255, 0.8);
    padding: 10px;
    border-radius: 10px;
    font-family: monospace;
  }
</style>
