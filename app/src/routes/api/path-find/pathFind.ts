import { transientSplit } from '$lib/transient-split';
import { pathFind } from '$lib/path_finder';
import { CrossConvert } from '$lib/cross_transform';
import { transformOSMMapToOSMGraph } from '$lib/map_loader/osm';
import { fold2DegreeEdges } from '$lib/fold2degree';

import { requireOSMData } from '../osm';
import { cacheManager } from '../osm/fs-cache-manager';
import { fetchOverpassData } from '../osm/osm-fetcher';
import { trimOSMDataByWayHighway } from '../osm/osm-data';
import { distanceOf } from '$lib/utils/haversine';

/**
 * 経路の辺列から、始点を含むノード列を走行順に復元する。
 * pathToCoordinates と同じ走査を行う。
 */
export function pathToNodeIds(mapData: App.SearchGraph, edgeIds: App.EdgeId[], begin: App.NodeId): App.NodeId[] {
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
export function countPassedIntersections(mapData: App.SearchGraph, pathNodes: App.NodeId[]): number {
    const crossNodeCount = pathNodes.filter((id) => mapData.nodes[id]?.type === "MapVCrossNode").length;
    return Math.floor(crossNodeCount / 2);
}

export function pathToCoordinates(mapData: App.SearchGraph, edgeIds: App.EdgeId[], begin: App.NodeId): App.Coordinate[] {
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
            throw new Error(`Edge ${edgeId} does not connect to current node ${current}`);
        }

        if (edge.type === "MapVCrossEdge") {
            res.push(mapData.nodes[nextNodeId].coordinate);
        } else {
            for (const segment of reversed ? [...edge.segments].reverse() : edge.segments) {
                res.push(reversed ? segment.begin_coordinate : segment.end_coordinate);
            }
        }
        current = nextNodeId;
    }
    return res;
}

function calcTotalDistance(path: App.Coordinate[]) {
    if (path.length === 0)
        return 0;

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
function getBoundaryBox(begin: App.Coordinate, end: App.Coordinate): {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
} {
    return {
        minLat: Math.floor(Math.min(begin.lat, end.lat) / deltaLatitude) * deltaLatitude,
        minLng: Math.floor(Math.min(begin.lng, end.lng) / deltaLongitude) * deltaLongitude,
        maxLat: Math.ceil(Math.max(begin.lat, end.lat) / deltaLatitude) * deltaLatitude,
        maxLng: Math.ceil(Math.max(begin.lng, end.lng) / deltaLongitude) * deltaLongitude,
    }
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
    const rawOsmData = await requireOSMData(bbox, cacheManager, fetchOverpassData);
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
        }
    }
    const pathCoords = pathToCoordinates(mapData, pathEdges, beginNodeId);
    const pathNodes = pathToNodeIds(mapData, pathEdges, beginNodeId);

    return {
        found: true,
        coords: pathCoords,
        totalDistance: calcTotalDistance(pathCoords),
        totalIntersections: countPassedIntersections(mapData, pathNodes),
    }
}