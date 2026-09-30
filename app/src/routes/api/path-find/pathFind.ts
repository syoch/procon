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
 * 2つの座標からベクトルを作成する
 */
function getVector(coord1: App.Coordinate, coord2: App.Coordinate) {
    return {
        x: coord2.lng - coord1.lng,
        y: coord2.lat - coord1.lat,
    };
}

/**
 * ベクトルの長さを計算する
 */
function getVectorLength(v: { x: number; y: number }): number {
    return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * 2つのベクトルから、内積を使ってなす角（0〜180度）を求める関数
 */
function getVectorAngle(v1: { x: number; y: number }, v2: { x: number; y: number }): number {
    const dot = v1.x * v2.x + v1.y * v2.y;
    const len1 = getVectorLength(v1);
    const len2 = getVectorLength(v2);

    if (len1 === 0 || len2 === 0) return 0;

    let cosTheta = dot / (len1 * len2);
    cosTheta = Math.max(-1, Math.min(1, cosTheta)); // 誤差対策

    const rad = Math.acos(cosTheta);
    return (rad * 180) / Math.PI;
}

/**
 * 2次元の外積のZ成分を計算する（プラスなら右回り、マイナスなら左回り）
 */
function getCrossProduct2D(v1: { x: number; y: number }, v2: { x: number; y: number }): number {
    return v1.x * v2.y - v1.y * v2.x;
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

    graphData.type.push("start");
    graphData.distance.push(0);

    // 経路上にあるすべてのノードの座標を順番にキャッシュしておく（遡り用）
    const pathCoords: App.Coordinate[] = [];
    pathCoords.push(mapData.nodes[beginNodeId].coordinate);

    // 一旦、全エッジの基本データ（ノード・距離・種別）を配列として集める
    const rawSteps: { 
        edgeType: string; 
        dist: number; 
        isCross: boolean; 
        beginCoord: App.Coordinate; 
        endCoord: App.Coordinate; 
    }[] = [];

    for (let i = 0; i < edgeIds.length; i++) {
        const edgeId = edgeIds[i];
        const edge = mapData.edges[edgeId];
        const reversed = current === edge.end;
        const nextNodeId = reversed ? edge.begin : edge.end;

        if (!mapData.nodes[nextNodeId]) {
            throw new Error(`Node ${nextNodeId} not found in mapData`);
        }

        const beginCoord = mapData.nodes[current].coordinate;
        const endCoord = mapData.nodes[nextNodeId].coordinate;
        pathCoords.push(endCoord);

        const isCrossNode = mapData.nodes[nextNodeId]?.type === "MapVCrossNode";

        if (edge.type === "FoldedEdge") {
            let prevCoord = beginCoord;
            const segments = reversed ? [...edge.segments].reverse() : [...edge.segments];
            
            for (const seg of segments) {
                const targetCoord = reversed ? seg.begin_coordinate : seg.end_coordinate;
                const segDist = distanceOf(prevCoord, targetCoord);
                rawSteps.push({ edgeType: "segment", dist: segDist, isCross: false, beginCoord: prevCoord, endCoord: targetCoord });
                prevCoord = targetCoord;
            }
            const finalDist = distanceOf(prevCoord, endCoord);
            if (finalDist > 0) {
                rawSteps.push({ edgeType: "segment", dist: finalDist, isCross: isCrossNode, beginCoord: prevCoord, endCoord });
            } else if (rawSteps.length > 0) {
                // 最後のステップに交差点フラグを引き継ぐ
                rawSteps[rawSteps.length - 1].isCross = isCrossNode;
            }
        } else {
            const dist = distanceOf(beginCoord, endCoord);
            rawSteps.push({ edgeType: "segment", dist, isCross: isCrossNode, beginCoord, endCoord });
        }

        current = nextNodeId;
    }

    // --- 補助関数：十分な長さ（例: 2メートル以上）が稼げるまで、前後の座標を遡ってベクトルを作る ---
    function getReliableVector(currentIndex: number, isForward: boolean): { x: number; y: number } {
        let targetCoord = rawSteps[currentIndex].endCoord;
        let baseCoord = rawSteps[currentIndex].beginCoord;
        
        let vec = getVector(baseCoord, targetCoord);
        let dist = getVectorLength(vec);

        // 短すぎる場合、前後のステップを辿って長さを確保する（最大3ステップまで遡る）
        let stepOffset = 1;
        while (dist < 0.00001 && stepOffset <= 3) { // 緯度経度上のごく微小な距離
            if (isForward && currentIndex + stepOffset < rawSteps.length) {
                targetCoord = rawSteps[currentIndex + stepOffset].endCoord;
                vec = getVector(baseCoord, targetCoord);
                dist = getVectorLength(vec);
            } else if (!isForward && currentIndex - stepOffset >= 0) {
                baseCoord = rawSteps[currentIndex - stepOffset].beginCoord;
                vec = getVector(baseCoord, targetCoord);
                dist = getVectorLength(vec);
            }
            stepOffset++;
        }
        return vec;
    }

    // 2. 各ステップをループして、交差点なら信頼性の高いベクトルで角度計算を行う
    for (let i = 0; i < rawSteps.length; i++) {
        const step = rawSteps[i];

        if (step.isCross && i > 0 && i < rawSteps.length - 1) {
            // 手前のしっかりしたベクトルと、先のしっかりしたベクトルを取得
            const vPrev = getReliableVector(i - 1, false);
            const vNext = getReliableVector(i, true);

            const angle = getVectorAngle(vPrev, vNext);
            const cross = getCrossProduct2D(vPrev, vNext);

            let turnType = "交差点を直進";
            if (angle >= 60) {
                if (cross > 0) {
                    turnType = "右折";
                } else {
                    turnType = "左折";
                }
            }

            graphData.type.push(turnType);
            graphData.distance.push(step.dist);
        } else {
            graphData.type.push(step.edgeType);
            graphData.distance.push(step.dist);
        }
    }

    // 3. フィニッシュ地点の追加
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