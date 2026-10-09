import debugMap from './debug-map.json';

type GeoJSONPointGeometry = {
  type: 'Point';
  coordinates?: [number, number];
};

type GeoJSONLineStringGeometry = {
  type: 'LineString';
  coordinates?: Array<[number, number]>;
};

type GeoJSONGeometry =
  | GeoJSONPointGeometry
  | GeoJSONLineStringGeometry
  | {
    type?: string;
    coordinates?: unknown;
  };

type DebugFeature = {
  id?: string | number;
  geometry?: GeoJSONGeometry;
  properties?: Record<string, unknown>;
};

type DebugMap = {
  features?: DebugFeature[];
};

const coordKey = (lon: number, lat: number): string => `${lon},${lat}`;

const toTags = (properties: Record<string, unknown> = {}): Record<string, string> => {
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (key === '@id') continue;
    if (value != null) tags[key] = String(value);
  }
  return tags;
};

export function loadDebugMap(): App.OSMGraph {
  const { features = [] } = debugMap as DebugMap;
  const nodes: Record<string, App.MapNode> = {};
  const edges: Record<string, App.OSMEdge> = {};
  const nodeIdByCoord = new Map<string, string>();
  let nodeCount = 0;
  let edgeCount = 0;

  const createNode = (nodeId: string, lon: number, lat: number): App.MapNode => ({
    type: 'MapNode',
    id: nodeId,
    coordinate: { lng: lon, lat },
    edges: [],
  });

  const ensureNode = (lon: number, lat: number, preferredId?: string): string => {
    const key = coordKey(lon, lat);
    const existingNodeId = nodeIdByCoord.get(key);
    if (existingNodeId) return existingNodeId;

    const nodeId = preferredId || `node/${++nodeCount}`;
    nodeIdByCoord.set(key, nodeId);
    nodes[nodeId] = createNode(nodeId, lon, lat);
    return nodeId;
  };

  for (const feature of features) {
    const geometry = feature.geometry ?? {};
    if (geometry.type !== 'Point') continue;

    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const [lon, lat] = coordinates;
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;

    const properties = feature.properties ?? {};
    const id = String(feature.id ?? properties['@id'] ?? '');
    ensureNode(lon, lat, id || undefined);
  }

  for (const feature of features) {
    const geometry = feature.geometry ?? {};
    if (geometry.type !== 'LineString') continue;
    if (!Array.isArray(geometry.coordinates)) continue;

    const properties = feature.properties ?? {};
    const id = String(feature.id ?? properties['@id'] ?? `way/${++edgeCount}`);
    const tags = toTags(properties);
    const coordinates = geometry.coordinates;

    for (let index = 0; index < coordinates.length - 1; index += 1) {
      const beginCoordinate = coordinates[index] ?? [];
      const endCoordinate = coordinates[index + 1] ?? [];
      const [beginLon, beginLat] = beginCoordinate;
      const [endLon, endLat] = endCoordinate;
      if (
        typeof beginLon !== 'number' ||
        typeof beginLat !== 'number' ||
        typeof endLon !== 'number' ||
        typeof endLat !== 'number'
      ) {
        continue;
      }

      const beginNodeId = ensureNode(beginLon, beginLat);
      const endNodeId = ensureNode(endLon, endLat);
      if (beginNodeId === endNodeId) continue;

      const edgeId = `${id}/${index}`;
      edges[edgeId] = {
        type: 'OSMEdge',
        id: edgeId,
        begin: beginNodeId,
        end: endNodeId,
        highway: tags.highway ?? '',
        width: tags.width ? Number(tags.width) : -1,
        sidewalk: tags.sidewalk ?? null,
        direction: 'both',
        tags: {}
      };

      nodes[beginNodeId].edges.push(edgeId);
      nodes[endNodeId].edges.push(edgeId);
    }
  }

  return { nodes, edges };
}

