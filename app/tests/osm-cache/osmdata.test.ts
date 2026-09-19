import { test } from "vitest";
import { mergeOSMData, trimOSMData, type OSMData, type OSMRawNode } from "../../src/routes/api/osm/osm-data";
import { boundaryContains, type Boundary } from "../../src/routes/api/osm/boundary";

const DATA1: OSMData = {
  elements: [
    { "type": "node", id: 10, lat: 2, lon: -1 },
    { "type": "node", id: 11, lat: 2, lon: +1 },
    { "type": "way", id: 1, nodes: [10, 11], tags: { highway: "primary" } },

    { "type": "node", id: 20, lat: 0, lon: -1 },
    { "type": "node", id: 21, lat: 0, lon: +1 },
    { "type": "way", id: 2, nodes: [20, 21], tags: { highway: "residential" } },
  ]
};
const DATA2: OSMData = {
  elements: [
    { "type": "node", id: 30, lat: -2, lon: -1 },
    { "type": "node", id: 31, lat: -2, lon: +1 },
    { "type": "way", id: 3, nodes: [30, 31], tags: { highway: "secondary" } },

    { "type": "node", id: 20, lat: 0, lon: -1 },
    { "type": "node", id: 21, lat: 0, lon: +1 },
    { "type": "way", id: 2, nodes: [20, 21], tags: { highway: "residential" } },
  ]
};

const TRIM_BOUND: Boundary = {
  minLat: -1.5,
  maxLat: +1.5,
  minLng: -1.5,
  maxLng: +1.5,
};

test("mergeOSMData generated non duplicate elements", () => {
  const merged: OSMData = { elements: [] };
  mergeOSMData(merged, DATA1);
  mergeOSMData(merged, DATA2);

  const wayIds = new Set<number>();
  const nodeIds = new Set<number>();
  for (const element of merged.elements) {
    if (element.type === "way") {
      if (wayIds.has(element.id)) {
        throw new Error(`duplicate way id ${element.id}`);
      }
      wayIds.add(element.id);
    } else if (element.type === "node") {
      if (nodeIds.has(element.id)) {
        throw new Error(`duplicate node id ${element.id}`);
      }
      nodeIds.add(element.id);
    }
  }
});

test("mergeOSMData merged all elements", () => {
  const merged: OSMData = { elements: [] };
  mergeOSMData(merged, DATA1);
  mergeOSMData(merged, DATA2);

  const wayIds = new Set<number>();
  const nodeIds = new Set<number>();
  for (const element of merged.elements) {
    if (element.type === "way") {
      wayIds.add(element.id);
    } else if (element.type === "node") {
      nodeIds.add(element.id);
    }
  }

  for (const element of [...DATA1.elements, ...DATA2.elements]) {
    if (element.type === "way") {
      if (!wayIds.has(element.id)) {
        throw new Error(`missing way id ${element.id}`);
      }
    } else if (element.type === "node") {
      if (!nodeIds.has(element.id)) {
        throw new Error(`missing node id ${element.id}`);
      }
    }
  }
});

test("trimOSMData does not include way such as every nodes are out of bounds", () => {
  const merged: OSMData = { elements: [] };
  mergeOSMData(merged, DATA1);
  mergeOSMData(merged, DATA2);

  const trimmed = trimOSMData(merged, TRIM_BOUND);

  const nodeMap = new Map<number, OSMRawNode>();
  for (const element of trimmed.elements) {
    if (element.type === "node") {
      nodeMap.set(element.id, element);
    }
  }

  for (const element of trimmed.elements) {
    if (element.type !== "way") continue;

    let everyNodeOutOfBounds = true;
    for (const nodeId of element.nodes) {
      const node = nodeMap.get(nodeId);
      if (!node) {
        throw new Error(`way ${element.id} has node ${nodeId} which is not included in trimmed data`);
      }

      if (boundaryContains(TRIM_BOUND, { lat: node.lat, lng: node.lon })) {
        everyNodeOutOfBounds = false;
      }
    }

    if (everyNodeOutOfBounds) {
      throw new Error(`way ${element.id} has every node out of bounds`);
    }
  }
});
