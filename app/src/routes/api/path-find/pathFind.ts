import { transientSplit } from "$lib/transient-split";
import { pathFind } from "$lib/path_finder";
import { CrossConvert } from "$lib/cross_transform";
import { transformOSMMapToOSMGraph } from "$lib/map_loader/osm";
import { fold2DegreeEdges } from "$lib/fold2degree";

import { requireOSMData } from "../osm";
import { cacheManager } from "../osm/fs-cache-manager";
import { fetchOverpassData } from "../osm/osm-fetcher";
import { trimOSMDataByWayHighway } from "../osm/osm-data";
import { distanceOf } from "$lib/utils/haversine";

/**
 * 経路の辺列から、始点を含むノード列を走行順に復元する。
 * pathToCoordinates と同じ走査を行う。
 */
export function pathToNodeIds(
  mapData: App.SearchGraph,
  edgeIds: App.EdgeId[],
  begin: App.NodeId,
): App.NodeId[] {
  let current: App.NodeId = begin;
  const res: App.NodeId[] = [];
  res.push(begin);

  for (const edgeId of edgeIds) {
    const edge = mapData.edges[edgeId];
    const reversed = current === edge.end;
    const nextNodeId = reversed ? edge.begin : edge.end;

    res.push(nextNodeId);
    current = nextNodeId;
  }
  return res;
}

/**
 * 経路が通過した交差点の数を数える。
 *
 * CrossConvert は次数 3 以上の交差点 X を、隣接ノードごとに 1 つずつの
 * MapVCrossNode（X_{隣接}）を作り、それらの完全グラフで置き換える。
 * そのため X に入ってから出るまでのあいだに、必ず 2 つの MapVCrossNode を通る。
 * 物理的な交差点 1 個あたりの MapVCrossNode 数は 2 なので、
 * 2 で割ったものが交差点数になる。
 *
 * @param pathNodes 走行順のノード列（pathToNodeIds の戻り値）
 */
export function countPassedIntersections(
  mapData: App.SearchGraph,
  pathNodes: App.NodeId[],
): number {
  const crossNodeCount = pathNodes.filter(
    (id) => mapData.nodes[id]?.type === "MapVCrossNode",
  ).length;
  return Math.floor(crossNodeCount / 2);
}

export function pathToCoordinates(
  mapData: App.SearchGraph,
  edgeIds: App.EdgeId[],
  begin: App.NodeId,
): App.Coordinate[] {
  let current: App.NodeId = begin;
  if (!mapData.nodes[begin]) {
    throw new Error(`Node ${begin} not found in mapData`);
  }

  const res: App.Coordinate[] = [];
  res.push(mapData.nodes[begin].coordinate);

  for (const edgeId of edgeIds) {
    const edge = mapData.edges[edgeId];
    const reversed = current === edge.end;
    const nextNodeId = reversed ? edge.begin : edge.end;

    if (!mapData.nodes[nextNodeId]) {
      throw new Error(`Node ${nextNodeId} not found in mapData`);
    }
    if (edge.begin !== current && edge.end !== current) {
      throw new Error(
        `Edge ${edgeId} does not connect to current node ${current}`,
      );
    }

    if (edge.type === "MapVCrossEdge") {
      res.push(mapData.nodes[nextNodeId].coordinate);
    } else {
      for (const segment of reversed
        ? [...edge.segments].reverse()
        : edge.segments) {
        res.push(reversed ? segment.begin_coordinate : segment.end_coordinate);
      }
    }
    current = nextNodeId;
  }
  return res;
}

function calcTotalDistance(path: App.Coordinate[]) {
  if (path.length === 0) return 0;

  let current = path[0];
  let distance = 0;
  for (let i = 1; i < path.length; i++) {
    const nextPoint = path[i];
    const subDistance = distanceOf(current, nextPoint);

    distance += subDistance;
    current = nextPoint;
  }

  return distance;
}

const deltaLatitude = 0.015625; // 1/64
const deltaLongitude = 0.015625; // 1/64
function getBoundaryBox(
  begin: App.Coordinate,
  end: App.Coordinate,
): {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
} {
  return {
    minLat:
      Math.floor(Math.min(begin.lat, end.lat) / deltaLatitude) * deltaLatitude,
    minLng:
      Math.floor(Math.min(begin.lng, end.lng) / deltaLongitude) *
      deltaLongitude,
    maxLat:
      Math.ceil(Math.max(begin.lat, end.lat) / deltaLatitude) * deltaLatitude,
    maxLng:
      Math.ceil(Math.max(begin.lng, end.lng) / deltaLongitude) * deltaLongitude,
  };
}

/**
 * 指定されたエッジの実際の距離（セグメントがある場合はその総和）を測定する関数
 */
function getEdgeDistance(
  mapData: App.SearchGraph,
  edge: any,
  reversed: boolean,
  current: App.NodeId,
  nextNodeId: App.NodeId,
): number {
  let segmentDist = 0;

  if (edge.segments && edge.segments.length > 0) {
    let prevCoord = mapData.nodes[reversed ? edge.end : edge.begin].coordinate;
    const segments = reversed ? [...edge.segments].reverse() : edge.segments;

    for (const seg of segments) {
      const targetCoord = reversed ? seg.begin_coordinate : seg.end_coordinate;
      segmentDist += distanceOf(prevCoord, targetCoord);
      prevCoord = targetCoord;
    }

    const endCoord = mapData.nodes[nextNodeId].coordinate;
    segmentDist += distanceOf(prevCoord, endCoord);
  } else {
    const beginCoord = mapData.nodes[current].coordinate;
    const endCoord = mapData.nodes[nextNodeId].coordinate;
    segmentDist = distanceOf(beginCoord, endCoord);
  }

  return segmentDist;
}

function getVectorAngle(
  v1: { x: number; y: number },
  v2: { x: number; y: number },
): number {
  const dot = v1.x * v2.x + v1.y * v2.y;
  const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (len1 === 0 || len2 === 0) return 0;

  let cosTheta = dot / (len1 * len2);
  cosTheta = Math.max(-1, Math.min(1, cosTheta));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

function getCrossProduct2D(
  v1: { x: number; y: number },
  v2: { x: number; y: number },
): number {
  return v1.x * v2.y - v1.y * v2.x;
}

/**
 * キャッシュされたベクトルの中から、長さが十分にある手前の有効なベクトルを探す関数
 */
function getValidPrevVector(
  vectorCache: { x: number; y: number; isZero: boolean }[],
  currentIndex: number,
) {
  let k = currentIndex - 1;
  while (k >= 0) {
    if (!vectorCache[k].isZero) {
      return vectorCache[k];
    }
    k--;
  }
  return null;
}

/**
 * キャッシュされたベクトルの中から、長さが十分にある先の有効なベクトルを探す関数
 */
function getValidNextVector(
  vectorCache: { x: number; y: number; isZero: boolean }[],
  currentIndex: number,
) {
  let k = currentIndex;
  while (k < vectorCache.length) {
    if (!vectorCache[k].isZero) {
      return vectorCache[k];
    }
    k++;
  }
  return null;
}

/**
 * 修正版：交差点での右折・左折・直進を判定する関数（キャッシュを使用）
 */
function judgeTurnTypeWithCache(
  vectorCache: { x: number; y: number; isZero: boolean }[],
  currentIndex: number,
): string {
  const vIn = getValidPrevVector(vectorCache, currentIndex);
  const vOut = getValidNextVector(vectorCache, currentIndex);

  if (!vIn || !vOut) {
    return "straight";
  }

  const angle = getVectorAngle(vIn, vOut);
  const cross = getCrossProduct2D(vIn, vOut);

  if (angle > 150 || angle < 20) {
    return "straight";
  }
  if (cross > 0) {
    return "left";
  } else {
    return "right";
  }
}

export function buildInformationGraph(
  mapData: App.SearchGraph,
  edgeIds: App.EdgeId[],
  beginNodeId: App.NodeId,
): App.InformationGraph {
  let current: App.NodeId = beginNodeId;
  if (!mapData.nodes[beginNodeId]) {
    throw new Error(`Node ${beginNodeId} not found in mapData`);
  }

  const graphData: App.InformationGraph = {
    type: [],
    distance: [],
  };

  graphData.type.push("start");
  graphData.distance.push(0);

  // ★ 1. 各エッジを通ったときの「正しい向きのベクトル」を全エッジ分あらかじめ記録するキャッシュ
  const vectorCache: { x: number; y: number; isZero: boolean }[] = [];
  const stepDataList: { edgeType: string; dist: number; isCross: boolean }[] =
    [];

  let crossCount = 0;

  for (let i = 0; i < edgeIds.length; i++) {
    const edgeId = edgeIds[i];
    const edge = mapData.edges[edgeId];
    const nodeType = mapData.nodes[current]?.type;
    const reversed = current === edge.end;
    const nextNodeId = reversed ? edge.begin : edge.end;

    if (!mapData.nodes[nextNodeId]) {
      throw new Error(`Node ${nextNodeId} not found in mapData`);
    }

    const beginCoord = mapData.nodes[current].coordinate;
    const endCoord = mapData.nodes[nextNodeId].coordinate;

    // ★ 2. 進行方向（reversed）を考慮した正しいベクトルを作る
    // （逆向きなら end -> begin、正方向なら begin -> end になるようにする）
    const dx = endCoord.lng - beginCoord.lng;
    const dy = endCoord.lat - beginCoord.lat;
    const length = Math.sqrt(dx * dx + dy * dy);

    vectorCache.push({
      x: dx,
      y: dy,
      isZero: length < 0.000001, // ほぼ長さがゼロの交差点エッジかどうか
    });

    const dist = getEdgeDistance(mapData, edge, reversed, current, nextNodeId);

    let edgeType = "segments";
    if (nodeType === "MapVCrossNode") {
      if (crossCount === 1) {
        edgeType = "TURN_JUDGE"; // 後でまとめて判定する目印
        crossCount = 0;
      } else if (crossCount === 0) {
        edgeType = "segments";
        crossCount += 1;
      }
    } else {
      edgeType = "segments";
      crossCount = 0;
    }

    stepDataList.push({
      edgeType,
      dist,
      isCross: nodeType === "MapVCrossNode" && edgeType === "TURN_JUDGE",
    });
    current = nextNodeId;
  }

  // ★ 3. キャッシュされたベクトルを使って、TURN_JUDGE の部分で正しい角度・左右判定を行う
  for (let i = 0; i < stepDataList.length; i++) {
    const step = stepDataList[i];

    if (step.edgeType === "TURN_JUDGE") {
      const turnType = judgeTurnTypeWithCache(vectorCache, i);
      graphData.type.push(turnType as "straight" | "left" | "right");
      graphData.distance.push(0);
    } else {
      graphData.type.push(step.edgeType as "segments");
      graphData.distance.push(step.dist);
    }
  }

  graphData.type.push("finish");
  graphData.distance.push(0);

  return graphData;
}

export async function doPathFind(
  begin: App.Coordinate,
  end: App.Coordinate,
  parameters: App.SearchParameters,
  wayHighway: string[],
) {
  if (!begin || !end) {
    throw new Error("始点と終点を指定してください");
  }

  const bbox = getBoundaryBox(begin, end);
  const rawOsmData = await requireOSMData(
    bbox,
    cacheManager,
    fetchOverpassData,
  );
  const osmData = trimOSMDataByWayHighway(rawOsmData, wayHighway);
  const osmGraph = transformOSMMapToOSMGraph(osmData);
  const ccGraph = CrossConvert(osmGraph);
  if (ccGraph instanceof Error) {
    throw ccGraph;
  }
  const mapData = fold2DegreeEdges(ccGraph);
  if (mapData instanceof Error) {
    throw mapData;
  }
  if (Object.keys(mapData.edges).length === 0) {
    throw new Error("地図データを読み込み中です。少し待って再度お試しください");
  }

  const beginNodeId = transientSplit(mapData, begin);
  const endNodeId = transientSplit(mapData, end);

  const pathEdges = pathFind(mapData, parameters, [beginNodeId], [endNodeId]);
  if (pathEdges.length <= 0) {
    return {
      found: false,
    };
  }
  const pathCoords = pathToCoordinates(mapData, pathEdges, beginNodeId);
  const pathNodes = pathToNodeIds(mapData, pathEdges, beginNodeId);
  const infoGraph = buildInformationGraph(mapData, pathEdges, beginNodeId);

  return {
    found: true,
    coords: pathCoords,
    totalDistance: calcTotalDistance(pathCoords),
    totalIntersections: countPassedIntersections(mapData, pathNodes),
    infoGraph,
  };
}
