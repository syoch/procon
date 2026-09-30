import { transientSplit } from '$lib/transient-split';
import { pathFind } from '$lib/path_finder';
import { requireOSMData } from '../osm';
import { cacheManager } from '../osm/fs-cache-manager';
import { fetchOverpassData } from '../osm/osm-fetcher';
import { CrossConvert } from '$lib/cross_transform';
import { transformOSMMapToOSMGraph } from '$lib/map_loader/osm';
import { fold2DegreeEdges } from '$lib/fold2degree';
import { trimOSMDataByWayHighway } from '../osm/osm-data';





function pathToCoordinates(mapData: App.SearchGraph, edgeIds: App.EdgeId[], begin: App.NodeId): App.Coordinate[] {
    let current: App.NodeId = begin;
    const res: App.Coordinate[] = [];
    res.push(mapData.nodes[begin].coordinate);
    for (const edgeId of edgeIds) {
        const edge = mapData.edges[edgeId];
        const reversed = current === edge.end;

        if (edge.type === "MapVCrossEdge") {
            res.push(mapData.nodes[reversed ? edge.begin : edge.end].coordinate);
        } else {
            for (const segment of reversed ? [...edge.segments].reverse() : edge.segments) {
                res.push(segment.end_coordinate);
            }
        }
        current = reversed ? edge.begin : edge.end;
    }
    return res;
}

async function startSearch(mapData: App.SearchGraph, params: App.SearchParameters, begin: App.Coordinate, end: App.Coordinate) {
    if (!begin || !end) {
        throw new Error("始点と終点を指定してください");
    }
    if (Object.keys(mapData.edges).length === 0) {
        throw new Error("地図データを読み込み中です。少し待って再度お試しください");
    }


    const beginNodeId = transientSplit(mapData, begin);
    const endNodeId = transientSplit(mapData, end);

    console.time("pathFind");
    const result = pathFind(
        mapData,
        params,
        [beginNodeId],
        [endNodeId],
    );
    console.timeEnd("pathFind");

    return pathToCoordinates(mapData, result, beginNodeId);
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
    const bbox = getBoundaryBox(begin, end);
    const rawOsmData = await requireOSMData(bbox, cacheManager, fetchOverpassData);
    const osmData = trimOSMDataByWayHighway(rawOsmData, wayHighway);
    const osmGraph = transformOSMMapToOSMGraph(osmData);
    const ccGraph = CrossConvert(osmGraph);
    if (ccGraph instanceof Error) {
        throw ccGraph;
    }
    const f2dGraph = fold2DegreeEdges(ccGraph);
    if (f2dGraph instanceof Error) {
        throw f2dGraph;
    }

    return await startSearch(f2dGraph, parameters, begin, end);
}