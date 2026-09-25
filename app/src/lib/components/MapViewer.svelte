<script lang="ts">
  import { onMount } from "svelte";
  import L from "leaflet";

  let {
    map = $bindable(),
    mapData = $bindable(),
    pathResult = $bindable(),
    error = $bindable(),
    doLoadMap,
    onClick,
  }: {
    map: L.Map | undefined;
    mapData: App.GenericMap;
    pathResult: App.Coordinate[];
    error: string | null;
    doLoadMap: (
      minLat: number,
      minLng: number,
      maxLat: number,
      maxLng: number,
    ) => Promise<App.SearchGraph>;
    onClick: (lat: number, lng: number) => void;
  } = $props();

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

  let latestCallId = 0;
  async function loadMap() {
    const callId = latestCallId + 1;
    latestCallId += 1;

    const bounds = map?.getBounds();
    if (!bounds) {
      console.error("Failed to load map (bounds is falsy)");
      return;
    }
    const minLat = bounds.getSouth();
    const minLng = bounds.getWest();
    const maxLat = bounds.getNorth();
    const maxLng = bounds.getEast();
    console.log(minLat, minLng, maxLat, maxLng);
    try {
      const foldGraph = await doLoadMap(minLat, minLng, maxLat, maxLng);

      // 古い応答が返ってきた場合無視する
      if (latestCallId != callId) {
        return;
      }
      mapData = foldGraph;
    } catch (e) {
      console.error("Error loading map:", e);
    }
  }

  onMount(() => {
    map = L.map("map")
      .setView([37.4379, 138.8795], 18)
      .on("click", function (e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        onClick(lat, lng);
      })
      .on("moveend", async () => {
        await loadMap();
      })
      .whenReady(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        await loadMap();
      });

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
