<script lang="ts">
  import { onMount } from "svelte";
  import L from "leaflet";
  import {
    debugMapCCMap,
    debugMapOSMMap,
    debugMapSearchMap,
  } from "$lib/mocks/debug_map";

  type GenericMap = {
    nodes: { [key: App.NodeId]: App.MapVCrossNode | App.MapNode };
    edges: {
      [key: App.EdgeId]:
        | App.OSMEdge
        | App.MapVCrossEdge
        | App.edEdge
        | App.ComputedEdge;
    };
  };

  let map: L.Map | undefined = $state(undefined);
  let mapData: GenericMap | undefined = $state(undefined);

  function clearMap() {
    if (!map) {
      return;
    }
    map.eachLayer((layer) => {
      map?.removeLayer(layer);
    });
  }

  $effect(() => {
    if (mapData === undefined || map === undefined) {
      return;
    }

    clearMap();

    const mapMinLat = Math.min(
      ...Object.values(mapData.nodes).map((node) => node.coordinate.lat),
    );
    const mapMaxLat = Math.max(
      ...Object.values(mapData.nodes).map((node) => node.coordinate.lat),
    );
    const mapMinLng = Math.min(
      ...Object.values(mapData.nodes).map((node) => node.coordinate.lng),
    );
    const mapMaxLng = Math.max(
      ...Object.values(mapData.nodes).map((node) => node.coordinate.lng),
    );

    map.setView([(mapMinLat + mapMaxLat) / 2, (mapMinLng + mapMaxLng) / 2], 19);

    for (const node of Object.values(mapData.nodes)) {
      L.circleMarker([node.coordinate.lat, node.coordinate.lng])
        .addTo(map)
        .bindPopup(`Node ID: ${node.id}`);
    }

    for (const edge of Object.values(mapData.edges)) {
      const fromNode = mapData.nodes[edge.begin];
      const toNode = mapData.nodes[edge.end];

      if (edge.type == "FoldedEdge") {
        L.polyline(
          edge.segments.map((seg) => [
            seg.begin_coordinate,
            seg.end_coordinate,
          ]),
          { color: "green" },
        )
          .addTo(map)
          .bindPopup(`Edge ID: ${edge.id}`);
      } else {
        const color =
          edge.type == "MapVCrossEdge"
            ? "red"
            : edge.type == "ComputedEdge"
              ? "blue"
              : "gray";

        if (fromNode && toNode) {
          L.polyline(
            [
              [fromNode.coordinate.lat, fromNode.coordinate.lng],
              [toNode.coordinate.lat, toNode.coordinate.lng],
            ],
            { color },
          )
            .addTo(map)
            .bindPopup(`Edge ID: ${edge.id}`);
        }
      }
    }
  });

  onMount(() => {
    map = L.map("map").setView([0, 0], 2);
    return () => {
      if (map) {
        map.remove();
      }
    };
  });

  let customMapData: string = $state("");
  function loadMap(map: GenericMap) {
    mapData = map;
    customMapData = JSON.stringify(map);
  }
  function loadMapFromJSON(json: string) {
    try {
      mapData = JSON.parse(json) as GenericMap;
    } catch (e) {
      alert("Invalid JSON");
    }
  }
</script>

<div id="map"></div>
<div id="float-actions">
  <button onclick={() => loadMap(debugMapOSMMap)}>OSM Map</button>
  <button onclick={() => loadMap(debugMapCCMap)}>Cross Converted Map</button>
  <button onclick={() => loadMap(debugMapSearchMap)}>Search Map</button>
  <input bind:value={customMapData} placeholder="マップ文字列" />
  <button onclick={() => loadMapFromJSON(customMapData)}
    >マップ文字列読み込み</button
  >
  <button onclick={() => clearMap()}>マップクリア</button>
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

    display: flex;
    flex-direction: column;

    button,
    input {
      margin: 5px;
      display: block;
      height: 30px;
    }
  }
</style>
