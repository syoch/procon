<script lang="ts">
  import { onMount } from "svelte";
  import L from "leaflet";
  import DebugNodeIn from "$lib/ui/debug_node_in.svelte";
  import LocationInput from "$lib/ui/location_input.svelte";
  import { loadDebugMap } from "$lib/map_loader/debug";
  import { findNearestEdge, transientSplit } from "$lib/transient-split";
  import { CrossConvert } from "$lib/cross_transform";
  import { fold2DegreeEdges } from "$lib/fold2degree";
  import Button from "@smui/button";
  import { pathFind } from "$lib/path_finder";
  import Slider from "@smui/slider";
  import { assertGraph } from "$lib/utils/graph";

  let map: L.Map | undefined = $state(undefined);
  let error: string | null = $state(null);

  // #12 交差点変換が実装されたときに使う状態
  let minLat = $state(37.4379);
  let maxLat = $state(37.4389);
  let minLng = $state(138.8795);
  let maxLng = $state(138.8805);

  class SelectMarker {
    public point = $state<App.Coordinate | null>(null);
    public projectedPoint = $state<App.Coordinate | null>(null);
    private marker: L.Marker | null = null;

    constructor(map: L.Map) {
      $effect(() => {
        if (!this.projectedPoint) {
          return;
        }
        if (this.marker) {
          this.marker.remove();
        }
        this.marker = L.marker([
          this.projectedPoint.lat,
          this.projectedPoint.lng,
        ])
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
      if (this.marker) {
        this.marker.remove();
      }

      this.point = other.point;
      this.projectedPoint = other.projectedPoint;
      this.marker = other.marker;

      other.marker = null;
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

  let mapData = $state<App.SearchGraph>({ edges: {}, nodes: {} });
  let isLoading = $state(false);
  // #12 交差点変換が実装されたときに使う状態
  let lastLoadedRange: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  } | null = $state(null);
  $effect(() => {
    if (isLoading) {
      return;
    }
    if (lastLoadedRange) {
      if (
        minLat === lastLoadedRange.minLat &&
        maxLat === lastLoadedRange.maxLat &&
        minLng === lastLoadedRange.minLng &&
        maxLng === lastLoadedRange.maxLng
      ) {
        return;
      }
    }
    lastLoadedRange = { minLat, maxLat, minLng, maxLng };
    isLoading = true;
    (async () => {
      const osmGraph = loadDebugMap(); // TODO: loadOSMMap が実装されたら loadOSMMap に置き換える
      if (osmGraph instanceof Error) {
        throw { stage: "loadDebugMap", error: osmGraph };
      }
      assertGraph("Retrieved OSM graph", osmGraph);

      console.time("CrossConvert");
      const ccGraph = CrossConvert(osmGraph);
      console.timeEnd("CrossConvert");
      if (ccGraph instanceof Error) {
        throw { stage: "CrossConvert", error: ccGraph };
      }
      assertGraph("CrossConverted graph", ccGraph);

      console.time("fold2DegreeEdges");
      const foldGraph = fold2DegreeEdges(ccGraph);
      console.timeEnd("fold2DegreeEdges");
      if (foldGraph instanceof Error) {
        throw { stage: "Fold2DegreeEdges", error: foldGraph };
      }
      assertGraph("Folded graph", foldGraph);

      mapData = foldGraph;
    })()
      .then(() => {
        isLoading = false;
      })
      .catch((e) => {
        console.error("Error during map loading:", e);
        isLoading = false;
      });
  });

  let pathResult: App.Coordinate[] = $state([]);
  $effect(() => {
    if (!mapData) {
      return;
    }
    if (!map) {
      return;
    }

    map.eachLayer((layer) => {
      if (!map) return;
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
        if (!fromNode || !toNode) {
          console.warn(`MapVCrossEdge ${edge.id} has missing nodes`);
          continue;
        }
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
        L.polyline(nodes, { color: i++ % 2 === 0 ? "blue" : "red" })
          .addTo(map)
          .bindPopup(`Edge ID: ${edge.id}`);
        continue;
      }
      console.warn(
        `Edge ${edge.id} has missing nodes: fromNode=${fromNode?.id}, toNode=${toNode?.id}`,
      );

      const validNode = fromNode || toNode;
      if (!validNode) continue;
      L.circleMarker([validNode.coordinate.lat, validNode.coordinate.lng], {
        color: "orange",
      })
        .addTo(map)
        .bindPopup(`Edge ID: ${edge.id} (one node missing)`);
    }

    if (pathResult.length > 0) {
      L.polyline(pathResult, { color: "purple", weight: 5 })
        .addTo(map)
        .bindPopup(`Found path with ${pathResult.length} nodes`);
    }
  });

  function onClick(lat: number, lng: number) {
    console.debug("Clicked at", lat, lng);
    const res = findNearestEdge(mapData, { lat, lng }, map);
    if (!res) {
      console.error("No edge found");
      return;
    }

    selectedMarker?.setCoordinate({ lat, lng }, res.projection);
  }

  onMount(() => {
    map = L.map("map")
      .setView([37.4379, 138.8795], 18)
      .on("click", function (e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        onClick(lat, lng);
      })
      .on("moveend", () => {
        if (!map) return;
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

    return () => {
      if (!map) return;
      map.remove();
    };
  });

  function doFindPath() {
    assertGraph("doFindPath top", mapData);
    if (!beginMarker || !endMarker) {
      console.error("Begin or end marker is not set");
      return;
    }
    if (!beginMarker.projectedPoint || !endMarker.projectedPoint) {
      console.error("Begin or end marker projected point is not set");
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

    const beginNodeId = transientSplit(
      mapData,
      beginMarker.projectedPoint,
      map,
    );
    const endNodeId = transientSplit(mapData, endMarker.projectedPoint, map);

    console.time("pathFind");
    const result = pathFind(mapData, params, [beginNodeId], [endNodeId]);
    console.timeEnd("pathFind");

    pathResult = result
      .map((x) => {
        const edge = mapData.edges[x];
        const beginNode = mapData.nodes[edge.begin];
        const endNode = mapData.nodes[edge.end];
        if (!beginNode || !endNode) {
          console.warn(
            `Edge ${edge.id} has missing nodes: begin=${edge.begin}, end=${edge.end}`,
          );
          return [];
        }
        if (edge.type === "FoldedEdge") {
          return [
            beginNode.coordinate,
            ...edge.segments
              .map((s) => [s.begin_coordinate, s.end_coordinate])
              .flat(),
            endNode.coordinate,
          ].filter(Boolean);
        }
        return [beginNode.coordinate, endNode.coordinate];
      })
      .flat()
      .filter(Boolean);
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

  {#if error}
    <div style="color: red;">Error: {error}</div>
  {/if}
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
