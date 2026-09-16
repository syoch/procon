<script lang="ts">
  import L from "leaflet";

  let {
    mapData,
    on_map_click,
    map = $bindable(undefined),
  }: {
    mapData: App.GenericMap;
    on_map_click?: (latlng: L.LatLng) => void;
    map?: L.Map | undefined;
  } = $props();

  export function clearMap() {
    if (!map) {
      return;
    }
    map.eachLayer((layer) => {
      map?.removeLayer(layer);
    });
  }

  function detectMapBoundingRectangle(mapData: App.GenericMap) {
    let mapMinLat = Number.POSITIVE_INFINITY;
    let mapMaxLat = Number.NEGATIVE_INFINITY;
    let mapMinLng = Number.POSITIVE_INFINITY;
    let mapMaxLng = Number.NEGATIVE_INFINITY;

    for (const node of Object.values(mapData.nodes)) {
      if (node.coordinate.lat < mapMinLat) {
        mapMinLat = node.coordinate.lat;
      }
      if (node.coordinate.lat > mapMaxLat) {
        mapMaxLat = node.coordinate.lat;
      }
      if (node.coordinate.lng < mapMinLng) {
        mapMinLng = node.coordinate.lng;
      }
      if (node.coordinate.lng > mapMaxLng) {
        mapMaxLng = node.coordinate.lng;
      }
    }

    for (const edge of Object.values(mapData.edges).filter(
      (e) => e.type === "FoldedEdge",
    ) as App.FoldedEdge[]) {
      for (const seg of edge.segments) {
        if (seg.begin_coordinate.lat < mapMinLat) {
          mapMinLat = seg.begin_coordinate.lat;
        }
        if (seg.begin_coordinate.lat > mapMaxLat) {
          mapMaxLat = seg.begin_coordinate.lat;
        }
        if (seg.begin_coordinate.lng < mapMinLng) {
          mapMinLng = seg.begin_coordinate.lng;
        }
        if (seg.begin_coordinate.lng > mapMaxLng) {
          mapMaxLng = seg.begin_coordinate.lng;
        }

        if (seg.end_coordinate.lat < mapMinLat) {
          mapMinLat = seg.end_coordinate.lat;
        }
        if (seg.end_coordinate.lat > mapMaxLat) {
          mapMaxLat = seg.end_coordinate.lat;
        }
        if (seg.end_coordinate.lng < mapMinLng) {
          mapMinLng = seg.end_coordinate.lng;
        }
        if (seg.end_coordinate.lng > mapMaxLng) {
          mapMaxLng = seg.end_coordinate.lng;
        }
      }
    }

    return {
      minLat: mapMinLat,
      maxLat: mapMaxLat,
      minLng: mapMinLng,
      maxLng: mapMaxLng,
    };
  }

  $effect(() => {
    if (mapData === undefined || map === undefined) {
      return;
    }

    clearMap();

    const boundingRect = detectMapBoundingRectangle(mapData);
    console.log(map);
    console.log("Bounding rectangle:", boundingRect);
    console.log("Nodes: ", Object.values(mapData.nodes).length);
    console.log("Edges: ", Object.values(mapData.edges).length);
    map.setView(
      [
        (boundingRect.minLat + boundingRect.maxLat) / 2,
        (boundingRect.minLng + boundingRect.maxLng) / 2,
      ],
      18,
    );

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

  $effect(() => {
    map = L.map("map").on("click", (e) => {
      on_map_click?.(e.latlng);
    });

    return () => {
      if (map) {
        map.remove();
      }
    };
  });
</script>

<div id="map"></div>

<style>
  #map {
    width: 100%;
    height: 100%;
  }
</style>
