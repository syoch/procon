<script lang="ts">
  import { onMount } from "svelte";
  import L from "leaflet";
  import DebugNodeIn from "$lib/ui/debug_node_in.svelte";
  import DebugParam from "$lib/ui/debug_param.svelte";
  import LocationInput from "$lib/ui/location_input.svelte";
  import { loadDebugMap } from "$lib/map_loader/debug";
  import ConsoleLogHook from "$lib/ui/console_log_hook.svelte";
  import { findNearestEdge, transientSplit } from "$lib/transient-split";
  import { loadOSMMap } from "$lib/map_loader/osm";
  import { CrossConvert } from "$lib/cross_transform";
  import { fold2DegreeEdges } from "$lib/fold2degree";
  import { derived } from "svelte/store";
  import { SelectMarker, updateMarker } from "./page-helper";

  let map: L.Map;

  let minLat = $state(37.4379);
  let maxLat = $state(37.4389);
  let minLng = $state(138.8795);
  let maxLng = $state(138.8805);

  let selectedMarker: SelectMarker | null = $state(null);
  let beginMarker: SelectMarker | null = $state(null);
  let endMarker: SelectMarker | null = $state(null);
  let consoleLogBuf: ConsoleLogHook;

  let fetchedGraph = $state<App.SearchGraph>({ edges: {}, nodes: {} });
  $effect(() => {
    (() => {
      // await loadOSMMap(minLat, minLng, maxLat, maxLng)
      const osmGraph = loadDebugMap();
      const ccGraph = CrossConvert(osmGraph);
      if (ccGraph instanceof Error) {
        throw { stage: "CrossConvert", error: ccGraph };
      }
      const foldGraph = fold2DegreeEdges(ccGraph);
      if (foldGraph instanceof Error) {
        throw { stage: "CrossConvert", error: foldGraph };
      }

      fetchedGraph = foldGraph;
    })();
  });

  let mapData = $derived(
    updateMarker(
      selectedMarker,
      updateMarker(beginMarker, updateMarker(endMarker, fetchedGraph)),
    ),
  );

  $effect(() => {
    if (beginMarker && endMarker) {
      console.log(
        `Selected path: ${beginMarker.nodeId} -> ${endMarker.nodeId}`,
      );
    }
  });

  onMount(() => {
    map = L.map("map").setView([37.4379, 138.8795], 18);

    // タイルレイヤの追加
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    let i = 0;
    for (const edge of Object.values(mapData.edges)) {
      const fromNode = mapData.nodes[edge.begin];
      const toNode = mapData.nodes[edge.end];

      if (edge.type === "FoldedEdge") {
        const nodes = [
          fromNode?.coordinate,
          ...edge.segments
            .map((seg) => [seg.begin_coordinate, seg.end_coordinate])
            .flat(),
          toNode?.coordinate,
        ].filter(Boolean);
        L.polyline(nodes, { color: "green" })
          .addTo(map)
          .bindPopup(`Folded Edge ID: ${edge.id}`);
        continue;
      }
      if (edge.type === "MapVCrossEdge") {
        L.circleMarker([fromNode.coordinate.lat, fromNode.coordinate.lng], {
          color: "red",
          radius: 2,
        })
          .addTo(map)
          .bindPopup(`MapVCrossEdge ID: ${edge.id}`);
        continue;
      }

      if (fromNode && toNode) {
        const nodes = [fromNode.coordinate, toNode.coordinate];
        console.log(
          `Drawing edge ${edge.id} between nodes ${fromNode.id} and ${toNode.id}`,
        );
        L.polyline(nodes, { color: i++ % 2 === 0 ? "blue" : "red" })
          .addTo(map)
          .bindPopup(`Edge ID: ${edge.id}`);
        continue;
      }
      console.warn(
        `Edge ${edge.id} has missing nodes: fromNode=${fromNode?.id}, toNode=${toNode?.id}`,
      );

      if (!fromNode && !toNode) {
        console.warn(`Edge ${edge.id} has no valid nodes.`);
      }

      const validNode = fromNode || toNode;
      L.circleMarker([validNode.coordinate.lat, validNode.coordinate.lng], {
        color: "orange",
      })
        .addTo(map)
        .bindPopup(`Edge ID: ${edge.id} (one node missing)`);
    }

    map.on("click", function (e) {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      const nodeId = `ts-${lat},${lng}`;

      mapData = transientSplit(mapData, nodeId, { lat, lng }, map);

      const node = mapData.nodes[nodeId];

      if (selectedMarker) {
        selectedMarker.dispose();
      }
      selectedMarker = new SelectMarker(map, node.coordinate, node.id);
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
      bind:selected_node_id={selectedMarker}
      bind:begin_node_id={beginMarker}
      bind:end_node_id={endMarker}
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
    max-width: 300px;
  }
</style>
