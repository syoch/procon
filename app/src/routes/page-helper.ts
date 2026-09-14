import { transientSplit } from "$lib/transient-split";
import L, { map } from "leaflet";


export class SelectMarker {
  marker: L.Marker;

  constructor(
    private map: L.Map,
    public coordinate: App.Coordinate,
    public nodeId: App.NodeId
  ) {
    this.marker = L.marker([
      coordinate.lat,
      coordinate.lng,
    ])
      .addTo(map)
      .bindPopup(`Node ID: ${nodeId}`);
    this.nodeId = nodeId;
  }

  dispose() {
    console.log(`Disposing marker for node ${this.nodeId}`);
    this.map.removeLayer(this.marker);
  }

  toString() {
    return `Node<${this.nodeId}>`;
  }
}

export function updateMarker(marker: SelectMarker | null, newMapData: App.SearchGraph, map?: L.Map) {
    if (!marker) {
      return newMapData;
    }
    
    const coord = marker.coordinate;
    return transientSplit(newMapData, `t${coord.lat}-${coord.lng}`, coord, map);
  }