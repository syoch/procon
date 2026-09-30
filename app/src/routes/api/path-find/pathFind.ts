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
export type informationGraph = {
    type: string[];      // 例: ["segmentsによる接続点", "交差点を直進", "右折", "左折", ...]
    distance: number[];  // それぞれの区間の距離
};

/**
 * 2つの座標間の方位角（ラジアンまたは度）を計算するヘルパー関数
 */
function getBearing(coord1: App.Coordinate, coord2: App.Coordinate): number {
    const lat1 = (coord1.lat * Math.PI) / 180;
    const lat2 = (coord2.lat * Math.PI) / 180;
    const dLon = ((coord2.lng - coord1.lng) * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    
    let rad = Math.atan2(y, x);
    let deg = (rad * 180) / Math.PI;
    return (deg + 360) % 360; // 0〜360度に正規化
}

/**
 * 2つの角度の差分（-180度 〜 180度）を計算するヘルパー関数
 * プラスなら右回り、マイナスなら左回り
 */
function getAngleDiff(angle1: number, angle2: number): number {
    let diff = angle2 - angle1;
    while (diff < -180) diff += 360;
    while (diff > 180) diff -= 360;
    return diff;
}

export function buildInformationGraph(
    mapData: App.SearchGraph,
    edgeIds: App.EdgeId[],
    beginNodeId: App.NodeId
): informationGraph {
    let current: App.NodeId = beginNodeId;
    if (!mapData.nodes[beginNodeId]) {
        throw new Error(`Node ${beginNodeId} not found in mapData`);
    }

    const graphData: informationGraph = {
        type: [],
        distance: [],
    };

    // ひとつ手前のエッジの「抜け方向のベクトル（方位角）」を保持しておく変数
    let lastBearing: number | null = null;

    for (let i = 0; i < edgeIds.length; i++) {
        const edgeId = edgeIds[i];
        const edge = mapData.edges[edgeId];
        const reversed = current === edge.end;
        const nextNodeId = reversed ? edge.begin : edge.end;

        if (!mapData.nodes[nextNodeId]) {
            throw new Error(`Node ${nextNodeId} not found in mapData`);
        }

        // このエッジの「開始座標」と「終了座標」を確定
        const beginCoord = mapData.nodes[current].coordinate;
        const endCoord = mapData.nodes[nextNodeId].coordinate;

        // このエッジ自体の方向（方位角）を計算
        const currentBearing = getBearing(beginCoord, endCoord);

        // 1. 折り畳まれた道路（FoldedEdge）の場合
        if (edge.type === "FoldedEdge") {
            let prevCoord = mapData.nodes[reversed ? edge.end : edge.begin].coordinate;
            const segments = reversed ? [...edge.segments].reverse() : edge.segments;
            
            for (const seg of segments) {
                const targetCoord = reversed ? seg.begin_coordinate : seg.end_coordinate;
                const segDist = distanceOf(prevCoord, targetCoord);
                
                graphData.type.push("segmentsによる接続点");
                graphData.distance.push(segDist);
                
                prevCoord = targetCoord;
            }
            
            const finalDist = distanceOf(prevCoord, endCoord);
            if (finalDist > 0) {
                graphData.type.push("segmentsによる接続点");
                graphData.distance.push(finalDist);
            }
        } 
        // 2. 通常のエッジや交差点関連のエッジの場合
        else {
            const dist = distanceOf(beginCoord, endCoord);
            const isCrossNode = mapData.nodes[nextNodeId]?.type === "MapVCrossNode";

            if (isCrossNode && lastBearing !== null) {
                // ★ ここで前後の角度差を計算して「右折」「左折」「直進」を判定する
                const diff = getAngleDiff(lastBearing, currentBearing);

                let turnType = "交差点を直進";
                if (diff > 40) {
                    turnType = "右折"; // 角度が右に40度以上曲がっている場合
                } else if (diff < -40) {
                    turnType = "左折"; // 角度が左に40度以上曲がっている場合
                }

                graphData.type.push(turnType);
                graphData.distance.push(dist);
            } else {
                // 交差点を跨がない通常のエッジ、あるいは最初のノード
                graphData.type.push("segmentsによる接続点");
                graphData.distance.push(dist);
            }
        }

        // 次のループのために、このエッジの終了時の方向を保存
        lastBearing = currentBearing;
        current = nextNodeId;
    }

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
    const infoGraph = buildInformationGraph(mapData, pathEdges, beginNodeId);

    return {
        found: true,
        coords: pathCoords,
        totalDistance: calcTotalDistance(pathCoords),
        totalIntersections: countPassedIntersections(mapData, pathNodes),
        infoGraph,
    }
}