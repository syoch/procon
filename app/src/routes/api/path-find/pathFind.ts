import { transientSplit } from '$lib/transient-split';
import { largestComponentEdges } from '$lib/utils/graph';
import { pathFind, type PathFindOptions } from '$lib/path_finder';
import { MODE_PROFILES, type ModeId } from '$lib/mode_profiles';
import { collectRoadJunctions, detectSharpTurnsOnPath, type SharpTurn, type SharpTurnOptions } from '$lib/sharp_turn';
import { requireOSMData } from '../osm';
import { cacheManager } from '../osm/fs-cache-manager';
import { fetchOverpassData } from '../osm/osm-fetcher';
import { CrossConvert } from '$lib/cross_transform';
import { transformOSMMapToOSMGraph } from '$lib/map_loader/osm';
import { fold2DegreeEdges } from '$lib/fold2degree';
import { trimOSMDataByMode, trimOSMDataByWayHighway } from '../osm/osm-data';
import { distanceOf } from '$lib/utils/haversine';

/**
 * 始点・終点を道に吸着したときに許すずれの上限 [m]
 * これより遠い道にしか吸着できない場合は、間違った場所への経路を黙って返さないようにエラーにする (仮の値)
 */
export const MAX_SNAP_DISTANCE_M = 200;

/**
 * 経路探索の結果をユーザーに伝えるべきエラー (到達できない場合など)
 * API では 422 とメッセージを返す
 */
export class PathFindError extends Error {
    constructor(message: string, public readonly code: "BEGIN_UNREACHABLE" | "END_UNREACHABLE" | "NO_ROUTE") {
        super(message);
        this.name = "PathFindError";
    }
}




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

/** /api/path-find の応答 */
export type PathFindResult = {
    /** 経路の座標列 (進行順) */
    path: App.Coordinate[];
    /** 経路上の急カーブ (道の途中のカーブのみ。検出しないモードでは空) */
    sharpTurns: SharpTurn[];
    /** 指定された始点・終点から、吸着した道の上の点までの距離 [m] */
    snapDistance: { begin: number; end: number };
};

/**
 * @param sharpTurnOptions 急カーブ判定の条件。undefined なら急カーブを検出しない
 */
async function startSearch(mapData: App.SearchGraph, params: App.SearchParameters, begin: App.Coordinate, end: App.Coordinate, options: PathFindOptions = {}, sharpTurnOptions?: SharpTurnOptions): Promise<PathFindResult> {
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

    // 吸着先が遠すぎる場合 (近くの道が道路網から切り離されている場合など) は、間違った経路を返さずエラーにする
    const snapDistance = {
        begin: distanceOf(begin, mapData.nodes[beginNodeId].coordinate),
        end: distanceOf(end, mapData.nodes[endNodeId].coordinate),
    };
    if (snapDistance.begin > MAX_SNAP_DISTANCE_M) {
        throw new PathFindError(`出発地の近く (${MAX_SNAP_DISTANCE_M}m 以内) に、このモードで通れる道が見つかりません`, "BEGIN_UNREACHABLE");
    }
    if (snapDistance.end > MAX_SNAP_DISTANCE_M) {
        throw new PathFindError(`目的地の近く (${MAX_SNAP_DISTANCE_M}m 以内) に、このモードで通れる道が見つかりません`, "END_UNREACHABLE");
    }

    console.time("pathFind");
    const result = pathFind(
        mapData,
        params,
        [beginNodeId],
        [endNodeId],
        options,
    );
    console.timeEnd("pathFind");

    if (result.length === 0 && beginNodeId !== endNodeId) {
        throw new PathFindError("経路が見つかりませんでした", "NO_ROUTE");
    }

    const sharpTurns = sharpTurnOptions === undefined
        ? []
        : detectSharpTurnsOnPath(mapData, result, beginNodeId, sharpTurnOptions);

    return {
        path: pathToCoordinates(mapData, result, beginNodeId),
        sharpTurns,
        snapDistance,
    };

}

const deltaLatitude = 0.015625; // 1/64
const deltaLongitude = 0.015625; // 1/64
/**
 * 始点・終点を囲む範囲に足す余白 (格子のマス数)
 * 余白が無いと、範囲の外を回る道 (山道など) が切れて道路網から切り離されたり、
 * 範囲の外で交わる道が見えず交差点をカーブと誤判定したりするため
 */
const BOUNDARY_MARGIN_CELLS = 1;
/**
 * 経路探索に使う地図データの範囲を求める (1/64° の格子に合わせ、周りに余白を足す)
 */
export function getBoundaryBox(begin: App.Coordinate, end: App.Coordinate): {
    minLat: number;
    minLng: number;
    maxLat: number;
    maxLng: number;
} {
    return {
        minLat: (Math.floor(Math.min(begin.lat, end.lat) / deltaLatitude) - BOUNDARY_MARGIN_CELLS) * deltaLatitude,
        minLng: (Math.floor(Math.min(begin.lng, end.lng) / deltaLongitude) - BOUNDARY_MARGIN_CELLS) * deltaLongitude,
        maxLat: (Math.ceil(Math.max(begin.lat, end.lat) / deltaLatitude) + BOUNDARY_MARGIN_CELLS) * deltaLatitude,
        maxLng: (Math.ceil(Math.max(begin.lng, end.lng) / deltaLongitude) + BOUNDARY_MARGIN_CELLS) * deltaLongitude,
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

    // mode 未指定時は車と同じ基準 (道の基準値のみ) で急カーブを検出する
    const sharpTurnMinRadius = profile ? profile.sharpTurnMinRadius : 0;
    // 交差点は絞り込む前のデータで判定する (モードで外れた道との交差点も区切るため)
    const sharpTurnOptions = sharpTurnMinRadius === undefined
        ? undefined
        : { minRadius: sharpTurnMinRadius, junctions: collectRoadJunctions(rawOsmData), bounds: bbox };
    return await startSearch(f2dGraph, parameters, begin, end, { ignoreOneway: profile?.ignoreOneway }, sharpTurnOptions);
}