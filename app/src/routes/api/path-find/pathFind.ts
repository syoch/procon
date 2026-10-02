import { transientSplit } from '$lib/transient-split';
import { pathFind } from '$lib/path_finder';
import { largestComponentEdges } from '$lib/utils/graph';
import { MODE_PROFILES, type ModeId, type ModeProfile } from '$lib/mode_profiles';
import { collectRoadJunctions, detectSharpTurnsOnPath, type SharpTurn } from '$lib/sharp_turn';
import { CrossConvert } from '$lib/cross_transform';
import { transformOSMMapToOSMGraph } from '$lib/map_loader/osm';
import { fold2DegreeEdges } from '$lib/fold2degree';

import { requireOSMData } from '../osm';
import { cacheManager } from '../osm/fs-cache-manager';
import { fetchOverpassData } from '../osm/osm-fetcher';
import { trimOSMDataByMode, trimOSMDataByWayHighway } from '../osm/osm-data';
import { distanceOf } from '$lib/utils/haversine';
import { applyGsiWidths, GsiRoadIndex, measureSegmentsWidthCoverage, removeNarrowEdges, type GsiRoadSegment, type WidthCoverage } from '$lib/road_width';
import { GSI_FETCH_BUDGET_MS, MAX_GSI_TILES, requireGsiRoadSegmentsForTiles, tileKey, tilesAlongPath, type GsiTile } from '../gsi';
import { gsiCacheManager } from '../gsi/fs-cache-manager';
import { fetchGsiRoadTile } from '../gsi/gsi-fetcher';
import type { RequestContext } from '$lib/tracing/requestContext';
import { deltaLatitude, deltaLongitude } from '../osm/grid';

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

/**
 * 始点・終点を囲む範囲に足す余白 (格子のマス数)
 * 余白が無いと、範囲の外を回る道 (山道など) が切れて道路網から切り離されたり、
 * 範囲の外で交わる道が見えず交差点をカーブと誤判定したりするため
 */
const BOUNDARY_MARGIN_CELLS = 1;
/**
 * 経路探索に使う地図データの範囲を求める
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
 * 始点・終点を道に吸着したときに許すずれの上限 [m]
 * これより遠い道にしか吸着できない場合は、間違った場所への経路を黙って返さないように「到達できない」とする (仮の値)
 */
export const MAX_SNAP_DISTANCE_M = 200;

/** /api/path-find の応答 */
export type PathFindResult =
    | {
        found: false;
        /** 見つからなかった理由 */
        reason: "BEGIN_UNREACHABLE" | "END_UNREACHABLE" | "NO_ROUTE";
        /** ユーザーに表示するメッセージ */
        message: string;
    }
    | {
        found: true;
        coords: App.Coordinate[];
        totalDistance: number;
        totalIntersections: number;
        /** 経路上の急カーブ (道の途中のカーブのみ。検出しないモードでは空) */
        sharpTurns: SharpTurn[];
        /** 指定された始点・終点から、吸着した道の上の点までの距離 [m] */
        snapDistance: { begin: number; end: number };
        /**
         * 経路の幅員の網羅率 (経路の区間のうち車両が通る道で、幅が分かっている区間の割合)。
         * 国土地理院のタイルが取れなかった範囲では幅の制限が効かないため、キャッシュの有無で結果が変わりうることを観測するためのもの
         */
        widthCoverage: WidthCoverage;
    };

/**
 * @param wayHighway 通行できる highway 種別 (mode を指定した場合は使わない)
 * @param mode 移動モード。指定した場合、通行可否・一方通行の扱いは mode_profiles.ts のルールで決まる
 */
export async function doPathFind(
    reqCtx: RequestContext,
    begin: App.Coordinate,
    end: App.Coordinate,
    parameters: App.SearchParameters,
    wayHighway: string[],
    mode?: ModeId,
): Promise<PathFindResult> {
    if (!begin || !end) {
        throw new Error("始点と終点を指定してください");
    }

    const bbox = getBoundaryBox(begin, end);
    const rawOsmData = await requireOSMData(reqCtx, bbox, cacheManager, fetchOverpassData);
    const profile = mode ? MODE_PROFILES[mode] : undefined;
    // mode 指定時はモードのルールで、未指定時は従来どおり highway 種別だけで絞り込む
    const osmData = profile
        ? reqCtx.measure("trim", () => trimOSMDataByMode(rawOsmData, profile))
        : reqCtx.measure("trim", () => trimOSMDataByWayHighway(rawOsmData, wayHighway));
    // 国土地理院の幅員は、探索範囲全体ではなく経路の周りのタイルだけ使う (長い経路でタイル数の上限を超えないようにするため)。
    // 1. 始点・終点の周りのタイルで探索する
    // 2. 見つかった経路の周りのタイルを足して、もう一度探索する (経路が変わったら、その周りのタイルも足して繰り返す)
    // 使うタイルは経路だけで決まり、キャッシュの有無には左右されない (取得に失敗したタイルを除く)
    // 制約: 探索は MAX_GSI_PASSES 回で打ち切るため、最後の探索で経路が変わった場合、その経路の一部は
    // 幅員のタイルを取得していない区間を通る (幅不明の道は removeNarrowEdges で残るので、大型トラックでは狭い道を通りうる)。
    // そのときは警告を出し、応答の widthCoverage (経路の区間のうち幅が分かる割合) が下がることで観測できる
    const startedAt = Date.now();
    const tiles = new Map<string, GsiTile>();
    const addTiles = (list: GsiTile[]) => list.forEach((tile) => tiles.set(tileKey(tile), tile));
    addTiles(tilesAlongPath([begin]));
    addTiles(tilesAlongPath([end]));
    const deadline = Date.now() + GSI_FETCH_BUDGET_MS;

    let result: PathFindResult;
    let pass = 1;
    for (; ; pass++) {
        const gsiSegments = await requireGsiRoadSegmentsForTiles([...tiles.values()], gsiCacheManager, fetchGsiRoadTile, {
            budgetMs: Math.max(0, deadline - Date.now()),
        });
        result = searchWithWidths(reqCtx, { begin, end, parameters, profile, osmData, rawOsmData, bbox }, gsiSegments);
        if (!result.found) break;

        const newTiles = tilesAlongPath(result.coords).filter((tile) => !tiles.has(tileKey(tile)));
        if (newTiles.length === 0) break;
        if (pass >= MAX_GSI_PASSES) {
            console.warn(
                `探索を ${MAX_GSI_PASSES} 回で打ち切ったため、経路の一部 (タイル ${newTiles.length} 枚分) は幅員なしで探索しています`,
            );
            break;
        }
        if (tiles.size + newTiles.length > MAX_GSI_TILES) {
            console.warn(`国土地理院タイルが上限 ${MAX_GSI_TILES} 枚を超えるため、経路の一部は幅員なしで探索します`);
            break;
        }
        addTiles(newTiles);
    }

    if (result.found) {
        const { ratio, known, total } = result.widthCoverage;
        console.info(
            `幅員データの網羅率 (経路): ${ratio === null ? "-" : (ratio * 100).toFixed(1) + "%"} (${known}/${total} 区間、タイル ${tiles.size} 枚、探索 ${pass} 回、${Date.now() - startedAt}ms)`,
        );
    }
    return result;
}

/**
 * 経路の周りのタイルを取り直して探索し直す回数の上限 (1 回目を含む・仮の値)
 * 1 回目は始点・終点の周りだけ、2 回目で経路の周り、3 回目で経路が変わった分を補う
 *
 * 3 で十分と考える理由:
 * - 1 → 2 回目で経路の形はほぼ決まる。幅員で変わるのは狭い道を避ける数十〜数百 m の区間 (大型トラックの除去・スコアの差) で、
 *   その区間は 2 回目のタイル (経路 ±1 タイル ≒ ±500m) の内側に収まることが多い
 * - 3 回目はその「ずれ」の分を補う。3 回目でも足りない場合は警告を出す (経路のほとんどは幅員つきで探索済み)
 * 回数を減らす・増やすときの目安:
 * - 1 回ごとにグラフ構築と経路探索をやり直すので、探索の時間はおおむね回数に比例する (ログの ms で確認できる)
 * - 使うタイルは全部の回を通して MAX_GSI_TILES (1024 枚) まで。メモリのキャッシュ (gsi/fs-cache-manager.ts の
 *   MAX_MEMORY_TILES = 2048 枚) はその 2 倍なので、回数を増やしても 1 回の検索で触れるタイルはメモリに収まる
 */
export const MAX_GSI_PASSES = 3;

type SearchContext = {
    begin: App.Coordinate;
    end: App.Coordinate;
    parameters: App.SearchParameters;
    profile: ModeProfile | undefined;
    /** モードで絞り込んだ地図データ */
    osmData: App.OSMData;
    /** 絞り込む前の地図データ (急カーブの交差点の判定に使う) */
    rawOsmData: App.OSMData;
    bbox: ReturnType<typeof getBoundaryBox>;
};

/**
 * 国土地理院の幅員を補った地図で 1 回探索する
 * (幅員の補完・狭い道の除去でグラフを書き換えるため、毎回 osmData からグラフを作り直す)
 */
function searchWithWidths(
    reqCtx: RequestContext,
    { begin, end, parameters, profile, osmData, rawOsmData, bbox }: SearchContext,
    gsiSegments: GsiRoadSegment[],
): PathFindResult {
    const osmGraph = transformOSMMapToOSMGraph(osmData);

    // 国土地理院の幅員区分で、幅が分からない車道の幅を補う (取得できなかったタイルは幅なしのまま続行する)
    applyGsiWidths(osmGraph, new GsiRoadIndex(gsiSegments));
    // 大型トラックなど、幅の下限があるモードでは狭すぎる道を取り除く (幅が分からない道は残す)
    if (profile?.minRoadWidth) {
        removeNarrowEdges(osmGraph, profile.minRoadWidth);
    }

    const ccGraph = reqCtx.measure("crossConvert", () => CrossConvert(osmGraph));
    if (ccGraph instanceof Error) {
        throw ccGraph;
    }
    const mapData = reqCtx.measure("fold2deg", () => fold2DegreeEdges(ccGraph));
    if (mapData instanceof Error) {
        throw mapData;
    }
    if (Object.keys(mapData.edges).length === 0) {
        throw new Error("地図データを読み込み中です。少し待って再度お試しください");
    }

    // 孤立した小さな道路網 (敷地内の道など) に吸着すると経路が見つからないため、
    // 最大連結成分のエッジだけを吸着の候補にする
    const mainEdges = largestComponentEdges(mapData);
    const beginNodeId = transientSplit(mapData, begin, mainEdges);
    const endNodeId = transientSplit(mapData, end, mainEdges);

    // 吸着先が遠すぎる場合 (近くの道が道路網から切り離されている場合など) は、間違った経路を返さず「到達できない」とする
    const snapDistance = {
        begin: distanceOf(begin, mapData.nodes[beginNodeId].coordinate),
        end: distanceOf(end, mapData.nodes[endNodeId].coordinate),
    };
    if (snapDistance.begin > MAX_SNAP_DISTANCE_M) {
        return {
            found: false,
            reason: "BEGIN_UNREACHABLE",
            message: `出発地の近く (${MAX_SNAP_DISTANCE_M}m 以内) に、このモードで通れる道が見つかりません`,
        };
    }
    if (snapDistance.end > MAX_SNAP_DISTANCE_M) {
        return {
            found: false,
            reason: "END_UNREACHABLE",
            message: `目的地の近く (${MAX_SNAP_DISTANCE_M}m 以内) に、このモードで通れる道が見つかりません`,
        };
    }

    const searchOptions = {
        ignoreOneway: profile?.ignoreOneway,
        highwayCostFactor: profile?.highwayCostFactor,
        scoring: profile?.scoring,
    };
    const pathEdges = reqCtx.measure("pathFind", () => pathFind(mapData, parameters, [beginNodeId], [endNodeId], searchOptions));
    if (pathEdges.length <= 0) {
        return {
            found: false,
            reason: "NO_ROUTE",
            message: "経路が見つかりませんでした。",
        };
    }
    const pathCoords = pathToCoordinates(mapData, pathEdges, beginNodeId);
    const pathNodes = pathToNodeIds(mapData, pathEdges, beginNodeId);

    // 急カーブの検出 (mode 未指定時は車と同じ基準 (道の基準値のみ) で検出する)
    // 交差点は絞り込む前のデータで判定する (モードで外れた道との交差点も区切るため)
    const sharpTurnMinRadius = profile ? profile.sharpTurnMinRadius : 0;
    const sharpTurns = sharpTurnMinRadius === undefined
        ? []
        : detectSharpTurnsOnPath(mapData, pathEdges, beginNodeId, {
            minRadius: sharpTurnMinRadius,
            junctions: collectRoadJunctions(rawOsmData),
            bounds: bbox,
        });

    // 幅員の網羅率は経路の区間について求める (タイルは経路の周りだけ取得するため、地図全体では意味のある値にならない)
    const pathSegments = pathEdges.flatMap((id) => {
        const edge = mapData.edges[id];
        return edge && "segments" in edge ? edge.segments : [];
    });

    return {
        found: true,
        coords: pathCoords,
        totalDistance: calcTotalDistance(pathCoords),
        totalIntersections: countPassedIntersections(mapData, pathNodes),
        sharpTurns,
        snapDistance,
        widthCoverage: measureSegmentsWidthCoverage(pathSegments),
    };
}
