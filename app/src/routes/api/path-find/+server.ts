import { json } from '@sveltejs/kit';

import type { RequestHandler } from './$types';
import { z } from 'zod';
import { transientSplit } from '$lib/transient-split';
import { pathFind } from '$lib/path_finder';
import { requireOSMData } from '../osm';
import { cacheManager } from '../osm/fs-cache-manager';
import { fetchOverpassData } from '../osm/osm-fetcher';
import { CrossConvert } from '$lib/cross_transform';
import { transformOSMMapToOSMGraph } from '$lib/map_loader/osm';
import { fold2DegreeEdges } from '$lib/fold2degree';
import { trimOSMDataByWayHighway } from '../osm/osm-data';


const coordinateSchema = z.object({
    lat: z.number(),
    lng: z.number()
});
const paramsSchema = z.object({
    mix_score_weight: z.number(),
    view_score_weight: z.number(),
    width_score_weight: z.number(),
    lambda: z.number(),
});
const requestSchema = z.object({
    begin: coordinateSchema,
    end: coordinateSchema,
    parameters: paramsSchema,
    wayHighway: z.array(z.string()),
});

function pathToCoordinates(mapData: App.SearchGraph, edgeIds: App.EdgeId[]): App.Coordinate[] {
    return edgeIds
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

    return pathToCoordinates(mapData, result);

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


export const POST: RequestHandler = async ({ request }) => {
    const body = await request.json();
    const query = requestSchema.safeParse(body);
    if (!query.success) {
        return json({ error: 'Invalid request body', details: query.error.issues }, { status: 400 });
    }

    const bbox = getBoundaryBox(query.data.begin, query.data.end);
    const rawOsmData = await requireOSMData(bbox, cacheManager, fetchOverpassData);
    const osmData = trimOSMDataByWayHighway(rawOsmData, query.data.wayHighway);
    const osmGraph = transformOSMMapToOSMGraph(osmData);
    const ccGraph = CrossConvert(osmGraph);
    if (ccGraph instanceof Error) {
        throw ccGraph;
    }
    const f2dGraph = fold2DegreeEdges(ccGraph);
    if (f2dGraph instanceof Error) {
        throw f2dGraph;
    }

    const res = await startSearch(f2dGraph, query.data.parameters, query.data.begin, query.data.end);
    return json(res);
};
