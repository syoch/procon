<script lang="ts">
  import { onMount } from "svelte";
  import L from "leaflet";
  import DebugNodeIn from "$lib/ui/debug_node_in.svelte";
  import DebugParam from "$lib/ui/debug_param.svelte";
  import LocationInput from "$lib/ui/location_input.svelte";
  import { loadDebugMap } from "$lib/map_loader/debug";
  import ConsoleLogHook from "$lib/ui/console_log_hook.svelte";
  import { findNearestEdge, transientSplit } from "$lib/transient-split";
  import { CrossConvert } from "$lib/cross_transform";
  import { fold2DegreeEdges } from "$lib/fold2degree";
  import Button from "@smui/button";
  import { generateInitSearchState, pathFind } from "$lib/path_finder";
  import Slider from "@smui/slider";

  let map: L.Map;

  let minLat = $state(37.4379);
  let maxLat = $state(37.4389);
  let minLng = $state(138.8795);
  let maxLng = $state(138.8805);

  class SelectMarker {
    public point = $state<App.Coordinate>({ lat: 0, lng: 0 });
    public projectedPoint = $state<App.Coordinate>({ lat: 0, lng: 0 });
    private marker: L.Marker = L.marker([0, 0]);

    constructor(map: L.Map) {
      $effect(() => {
        if (!this.projectedPoint) {
          return;
        }
        this.marker
          .setLatLng([this.projectedPoint.lat, this.projectedPoint.lng])
          .addTo(map)
          .bindPopup(
            `Projected Node at ${this.projectedPoint.lat}, ${this.projectedPoint.lng}`,
          );
      });
    }

    public setCoordinate(
      point: App.Coordinate,
      projectedPoint: App.Coordinate,
    ) {
      this.point = point;
      this.projectedPoint = projectedPoint;
    }

    public moveFrom(other: SelectMarker) {
      this.point = other.point;
      this.projectedPoint = other.projectedPoint;

      other.point = { lat: 0, lng: 0 };
      other.projectedPoint = { lat: 0, lng: 0 };
    }

    toString() {
      return `SelectMarker(point: ${JSON.stringify(
        this.point,
      )}, projectedPoint: ${JSON.stringify(this.projectedPoint)})`;
    }
  }

  let selectedMarker: SelectMarker | null = $state(null);
  let beginMarker: SelectMarker | null = $state(null);
  let endMarker: SelectMarker | null = $state(null);
  let consoleLogBuf: ConsoleLogHook;

  let mapData = $state<App.SearchGraph>({ edges: {}, nodes: {} });
  $effect(() => {
    (() => {
      // await loadOSMMap(minLat, minLng, maxLat, maxLng)

      const osmGraph =
        minLat + minLng + maxLat + maxLng
          ? JSON.parse(JSON.stringify(loadDebugMap()))
          : 0;

      const ccGraph = CrossConvert(osmGraph);
      if (ccGraph instanceof Error) {
        throw { stage: "CrossConvert", error: ccGraph };
      }
      const foldGraph = fold2DegreeEdges(ccGraph);
      if (foldGraph instanceof Error) {
        throw { stage: "CrossConvert", error: foldGraph };
      }

      mapData = foldGraph;
    })();
  });

  $effect(() => {
    if (!mapData) {
      return;
    }
    if (!map) {
      return;
    }

    map.eachLayer((layer) => {
      if (layer instanceof L.Polyline || layer instanceof L.CircleMarker) {
        map.removeLayer(layer);
      }
    });

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
  });

  onMount(() => {
    map = L.map("map")
      .setView([37.4379, 138.8795], 18)
      .on("click", function (e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        const res = findNearestEdge(mapData, { lat, lng }, map);
        if (!res) {
          console.error("No edge found");
          return;
        }

        selectedMarker?.setCoordinate({ lat, lng }, res.projection);
      })
      .on("moveend", () => {
        const bound = map.getBounds();
        minLng = bound.getWest();
        maxLng = bound.getEast();
        maxLat = bound.getNorth();
        minLat = bound.getSouth();
      });

    selectedMarker = new SelectMarker(map);
    beginMarker = new SelectMarker(map);
    endMarker = new SelectMarker(map);

    // タイルレイヤの追加
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    consoleLogBuf.patch_console_log();
    return () => {
      map.remove();
    };
  });

  function doFindPath() {
    if (!beginMarker || !endMarker) {
      console.error("Begin or end marker is not set");
      return;
    }
    if (
      beginMarker.projectedPoint.lat === 0 &&
      beginMarker.projectedPoint.lng === 0
    ) {
      console.error("Begin marker is not set");
      return;
    }
    if (
      endMarker.projectedPoint.lat === 0 &&
      endMarker.projectedPoint.lng === 0
    ) {
      console.error("End marker is not set");
      return;
    }

    const beginNodeId = `begin`;
    const endNodeId = `end`;
    mapData = transientSplit(
      mapData,
      beginNodeId,
      beginMarker.projectedPoint,
      map,
    );
    mapData = transientSplit(mapData, endNodeId, endMarker.projectedPoint, map);

    console.log("finding path...");
    const result = pathFind(mapData, params, [beginNodeId], [endNodeId]);
    console.log("path found");
    const pathNodes = result
      .map((x) => [mapData.edges[x].begin, mapData.edges[x].end])
      .flat()
      .map((nodeId) => mapData.nodes[nodeId]?.coordinate)
      .filter(Boolean);
    L.polyline(pathNodes, { color: "purple", weight: 5 })
      .addTo(map)
      .bindPopup(`Found path with ${result.length} edges`);
  }
  let params = $state<App.SearchParameters>({
    lambda: 1,
    mix_score_weight: 0.3,
    view_score_weight: 0.3,
    width_score_weight: 0.3,
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
    <Slider min={0} max={1} step={0.01} bind:value={params.mix_score_weight}
    ></Slider>
    <span>Mix Score Weight: {params.mix_score_weight}</span>
    <Slider min={0} max={1} step={0.01} bind:value={params.view_score_weight}
    ></Slider>
    <span>View Score Weight: {params.view_score_weight}</span>
    <Slider min={0} max={1} step={0.01} bind:value={params.width_score_weight}
    ></Slider>
    <span>Width Score Weight: {params.width_score_weight}</span>
  </div>
  <div id="LocationInput">
    <LocationInput></LocationInput>
  </div>
  <Button onclick={doFindPath}>Find path</Button>
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
