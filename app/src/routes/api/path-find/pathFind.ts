import { transientSplit } from '$lib/transient-split';
import { largestComponentEdges } from '$lib/utils/graph';
import { pathFind, type PathFindOptions } from '$lib/path_finder';
import { MODE_PROFILES, type ModeId } from '$lib/mode_profiles';
import { requireOSMData } from '../osm';
import { cacheManager } from '../osm/fs-cache-manager';
import { fetchOverpassData } from '../osm/osm-fetcher';
import { CrossConvert } from '$lib/cross_transform';
import { transformOSMMapToOSMGraph } from '$lib/map_loader/osm';
import { fold2DegreeEdges } from '$lib/fold2degree';
import { trimOSMDataByMode, trimOSMDataByWayHighway } from '../osm/osm-data';




/**
 * 経路の辺リストを、進行方向に並んだ座標列に変換する
 *
 * @param startNodeId 経路の始点ノード。辺を end → begin の向きに通る場合に座標を反転するため、
 *   どちらの端から入ったかを追跡するのに使う
 */
function pathToCoordinates(mapData: App.SearchGraph, edgeIds: App.EdgeId[], startNodeId: App.NodeId): App.Coordinate[] {
    // 現在いるノード (次の辺にどちらの端から入るかの判定に使う)
    let currentNodeId = startNodeId;
    return edgeIds
        .map((x) => {
            const edge = mapData.edges[x];
            const beginNode = mapData.nodes[edge.begin];
            const endNode = mapData.nodes[edge.end];
            // segments は begin → end の向きに並んでいるので、end 側から入った場合は反転する
            const reversed = edge.begin !== currentNodeId && edge.end === currentNodeId;
            currentNodeId = reversed ? edge.begin : edge.end;
            if (!beginNode || !endNode) {
                console.warn(
                    `Edge ${edge.id} has missing nodes: begin=${edge.begin}, end=${edge.end}`,
                );
                return [];
            }
            let coordinates: App.Coordinate[];
            if (edge.type === "FoldedEdge" || edge.type === "ComputedEdge") {
                coordinates = [
                    beginNode.coordinate,
                    ...edge.segments
                        .map((s) => [s.begin_coordinate, s.end_coordinate])
                        .flat(),
                    endNode.coordinate,
                ].filter(Boolean);
            } else {
                coordinates = [beginNode.coordinate, endNode.coordinate];
            }
            return reversed ? coordinates.toReversed() : coordinates;
        })
        .flat()
        .filter(Boolean);
}

async function startSearch(mapData: App.SearchGraph, params: App.SearchParameters, begin: App.Coordinate, end: App.Coordinate, options: PathFindOptions = {}) {
    if (!begin || !end) {
        throw new Error("始点と終点を指定してください");
    }
    if (Object.keys(mapData.edges).length === 0) {
        throw new Error("地図データを読み込み中です。少し待って再度お試しください");
    }


    // 孤立した小さな道路網 (敷地内の道など) に吸着すると経路が見つからないため、
    // 最大連結成分のエッジだけを吸着の候補にする
    const mainEdges = largestComponentEdges(mapData);
    const beginNodeId = transientSplit(mapData, begin, mainEdges);
    const endNodeId = transientSplit(mapData, end, mainEdges);

    console.time("pathFind");
    const result = pathFind(
        mapData,
        params,
        [beginNodeId],
        [endNodeId],
        options,
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

/**
 * @param wayHighway 通行できる highway 種別 (mode を指定した場合は使わない)
 * @param mode 移動モード。指定した場合、通行可否・一方通行の扱いは mode_profiles.ts のルールで決まる
 */
export async function doPathFind(
    begin: App.Coordinate,
    end: App.Coordinate,
    parameters: App.SearchParameters,
    wayHighway: string[],
    mode?: ModeId,
) {
    const bbox = getBoundaryBox(begin, end);
    const rawOsmData = await requireOSMData(bbox, cacheManager, fetchOverpassData);
    const profile = mode ? MODE_PROFILES[mode] : undefined;
    // mode 指定時はモードのルールで、未指定時は従来どおり highway 種別だけで絞り込む
    const osmData = profile
        ? trimOSMDataByMode(rawOsmData, profile)
        : trimOSMDataByWayHighway(rawOsmData, wayHighway);
    const osmGraph = transformOSMMapToOSMGraph(osmData);
    const ccGraph = CrossConvert(osmGraph);
    if (ccGraph instanceof Error) {
        throw ccGraph;
    }
    const f2dGraph = fold2DegreeEdges(ccGraph);
    if (f2dGraph instanceof Error) {
        throw f2dGraph;
    }

    return await startSearch(f2dGraph, parameters, begin, end, { ignoreOneway: profile?.ignoreOneway });
}