import { boundaryContains, type Boundary } from "./boundary";
import { isAccessible, resolveModeOneway, type ModeProfile } from "$lib/mode_profiles";
import { deltaLatitude, deltaLongitude } from "./grid";

/**
 * グリッド番号の組 (latIndex, lngIndex) を 1 つの数値に畳んで Map のキーにする。
 * 文字列を避けてハッシュ計算と短命オブジェクトの生成を無くすのが目的。
 *
 * 経度方向は最大でも ±180 / (1/64) = ±11520、緯度方向は ±90 / (1/64) = ±5760 なので
 * どちらの添字も 16384 をはみ出ない。16384 を足してから 65536 倍すれば衝突しない。
 */
const GRID_OFFSET = 16384;
const GRID_STRIDE = 65536;
function packGridIndex(latIndex: number, lngIndex: number) {
    return (latIndex + GRID_OFFSET) * GRID_STRIDE + (lngIndex + GRID_OFFSET);
}



export function mergeOSMData(data: App.OSMData, ...otherDatas: App.OSMData[]) {
    const dataWays = new Set(
        data.elements
            .filter(e => e.type === "way")
            .map(e => e.id)
    );
    const dataNodes = new Set(
        data.elements
            .filter(e => e.type === "node")
            .map(e => e.id)
    );

    for (const other of otherDatas) {
        for (const element of other.elements) {
            if (element.type === "way" && !dataWays.has(element.id)) {
                data.elements.push(element);
                dataWays.add(element.id);
            } else if (element.type === "node" && !dataNodes.has(element.id)) {
                data.elements.push(element);
                dataNodes.add(element.id);
            }
        }
    }
}

/**
 * 要素の形まで見るのは、`trimOSMData` が `element.nodes.every(...)` を呼ぶため。
 * way の `nodes` や node の `lat`/`lon` が欠けると TypeError になり、
 * Overpass を一度も呼ばずに経路探索が恒久的に 500 になる。
 *
 * 未知の `type` は通す（将来 Overpass が要素を追加しても壊れないように）。
 */
export function isOSMData(value: unknown): value is App.OSMData {
    if (typeof value !== "object" || value === null) return false;
    const elements = (value as { elements?: unknown }).elements;
    if (!Array.isArray(elements)) return false;

    return elements.every((element) => {
        if (typeof element !== "object" || element === null) return false;
        const e = element as { type?: unknown; lat?: unknown; lon?: unknown; nodes?: unknown };
        if (e.type === "node") {
            return typeof e.lat === "number" && typeof e.lon === "number";
        }
        if (e.type === "way") {
            return Array.isArray(e.nodes);
        }
        return true;
    });
}

export function trimOSMData(data: App.OSMData, boundary: Boundary): App.OSMData {
    const outputNodes = new Set<number>();
    const savedNodes = new Set<number>();
    for (const element of data.elements) {
        if (element.type !== "node") continue;

        if (!boundaryContains(boundary, { lat: element.lat, lng: element.lon })) {
            continue;
        }

        savedNodes.add(element.id);
        outputNodes.add(element.id);
    }

    const trimmedData: App.OSMData = {
        elements: []
    };
    for (const element of data.elements) {
        if (element.type !== "way") continue;

        if (element.nodes.every(nodeId => !savedNodes.has(nodeId))) {
            continue;
        }

        trimmedData.elements.push(element);

        for (const nodeId of element.nodes) {
            outputNodes.add(nodeId);
        }
    }

    for (const element of data.elements) {
        if (element.type !== "node") continue;

        if (!outputNodes.has(element.id)) {
            continue;
        }

        trimmedData.elements.push(element);
    }

    return trimmedData;
}

/**
 * スナップされた OSMData をグリッド事に分割する
 * @param data deltaLat/Lng 境界にスナップされた OSMData
 * @returns lat/lng でグリッド分けされた OSMData, キーは `lat,lon` の形式をとる
 */
export function SplitOSMData(data: App.OSMData) {
    const chunks: App.OSMData[] = [];
    const chunkNames: string[] = [];
    // キーは数値で持つ。文字列キーだとノード 1 個につきテンプレート文字列を
    // 1 個作ることになり、それだけで数千個の短命オブジェクトが出る
    const chunkIndexByNumber = new Map<number, number>();
    // ノードは要素順の通し番号で持つ。id -> 連番 の Map を 1 度だけ引けば済む
    const nodes: App.OSMRawNode[] = [];
    const chunkOfNode: number[] = [];
    const nodeIndexById = new Map<number, number>();
    // Overpass の出力は空間的に近接しているので、同じセルが連続する。
    // 直前のセル番号を覚えておけば Map の引き直しを几乎省略できる
    let previousLatIndex = Number.NaN;
    let previousLngIndex = Number.NaN;
    let previousChunkIndex = -1;

    for (const element of data.elements) {
        if (element.type !== "node") continue;
        const latIndex = Math.floor(element.lat / deltaLatitude);
        const lngIndex = Math.floor(element.lon / deltaLongitude);

        let chunkIndex: number;
        if (latIndex === previousLatIndex && lngIndex === previousLngIndex) {
            chunkIndex = previousChunkIndex;
        } else {
            const numberKey = packGridIndex(latIndex, lngIndex);
            const known = chunkIndexByNumber.get(numberKey);
            if (known === undefined) {
                chunkIndex = chunks.length;
                chunkIndexByNumber.set(numberKey, chunkIndex);
                chunks.push({elements: []});
                chunkNames.push(`${latIndex * deltaLatitude},${lngIndex * deltaLongitude}`);
            } else {
                chunkIndex = known;
            }
            previousLatIndex = latIndex;
            previousLngIndex = lngIndex;
            previousChunkIndex = chunkIndex;
        }

        nodeIndexById.set(element.id, nodes.length);
        nodes.push(element);
        chunkOfNode.push(chunkIndex);
    }

    // ノードを「どのチャンクへ出すか」。大半は 1 チャンクだけなので配列を作らず
    // 添字で持つ。複数必要なノードだけ Map に逃がす
    const singleChunkOfNode = new Int32Array(nodes.length).fill(-1);
    const multiChunksOfNode = new Map<number, number[]>();
    // way ごとに「すでに処理したチャンク」を記録する。way ごとに Set を作ると
    // 数千個の Set 割り当てになるので、way 番号をスタンプに使い回す
    const handledWay = new Int32Array(chunks.length).fill(-1);
    const targets: number[] = [];
    const nodeIndexesInWay: number[] = [];
    let wayCount = 0;

    for (const element of data.elements) {
        if (element.type !== "way") continue;
        const wayId = wayCount++;
        targets.length = 0;
        nodeIndexesInWay.length = 0;
        const nodeIds = element.nodes;

        for (const nodeId of nodeIds) {
            const nodeIndex = nodeIndexById.get(nodeId);
            if (nodeIndex === undefined) continue;
            nodeIndexesInWay.push(nodeIndex);
            const chunkIndex = chunkOfNode[nodeIndex];
            if (handledWay[chunkIndex] === wayId) continue;
            handledWay[chunkIndex] = wayId;
            targets.push(chunkIndex);
        }

        for (const target of targets) {
            chunks[target].elements.push(element);
        }

        for (const nodeIndex of nodeIndexesInWay) {
            const known2 = singleChunkOfNode[nodeIndex];
            if (known2 === -1) {
                const already = multiChunksOfNode.get(nodeIndex);
                if (already !== undefined) {
                    // 前の way で複数チャンクに記録済み。加えていく（上書きしない）
                    for (const target of targets) {
                        if (!already.includes(target)) already.push(target);
                    }
                    continue;
                }
                if (targets.length === 1) {
                    singleChunkOfNode[nodeIndex] = targets[0];
                    continue;
                }
                multiChunksOfNode.set(nodeIndex, targets.slice());
                continue;
            }

            let list = multiChunksOfNode.get(nodeIndex);
            if (list === undefined) {
                if (targets.length === 1 && known2 === targets[0]) continue;
                list = [known2];
                multiChunksOfNode.set(nodeIndex, list);
            }
            for (const target of targets) {
                if (!list.includes(target)) list.push(target);
            }
        }
    }

    for (let nodeIndex = 0; nodeIndex < nodes.length; nodeIndex++) {
        const multi = multiChunksOfNode.get(nodeIndex);
        if (multi !== undefined) {
            for (const chunkIndex of multi) {
                chunks[chunkIndex].elements.push(nodes[nodeIndex]);
            }
            continue;
        }
        const single = singleChunkOfNode[nodeIndex];
        if (single !== -1) {
            chunks[single].elements.push(nodes[nodeIndex]);
        }
    }

    return Object.fromEntries(chunks.map((chunk, i) => [chunkNames[i], chunk]))
}

/**
 * way を 1 本ずつ判定し、残した way と、それが参照するノードだけを含む OSM データを作る
 *
 * @param data OSM データ
 * @param selectWay 残す way を返す (タグを書き換えた way を返してもよい)。残さない場合は null を返す
 */
function trimOSMDataByWay(data: App.OSMData, selectWay: (way: App.OSMRawWay) => App.OSMRawWay | null): App.OSMData {
    const trimmedData: App.OSMData = {
        elements: []
    };

    const savedNodes = new Set<number>();
    for (const element of data.elements) {
        if (element.type !== "way") continue;

        const way = selectWay(element);
        if (!way) continue;

        trimmedData.elements.push(way);

        for (const nodeId of way.nodes) {
            savedNodes.add(nodeId);
        }
    }

    for (const element of data.elements) {
        if (element.type !== "node") continue;

        if (!savedNodes.has(element.id)) {
            continue;
        }

        trimmedData.elements.push(element);
    }

    return trimmedData;
}

/**
 * 移動モードで通行できる way (と、それが参照するノード) だけを残す
 *
 * trimOSMDataByWayHighway が highway 種別だけで判定するのに対し、
 * こちらは access 系タグ・自動車専用道路・寸法制限なども含めて mode_profiles.ts のルールで判定する。
 * また、モード専用の一方通行タグ (自転車の oneway:bicycle など) がある way は、そのタグで oneway を置き換える
 * (グラフ構築 (map_loader/osm.js) は oneway タグだけを見て通行方向を決めるため)。
 *
 * @param data OSM データ
 * @param profile 移動モード
 * @returns 通行できる way とそのノードだけを含む OSM データ
 */
export function trimOSMDataByMode(data: App.OSMData, profile: ModeProfile): App.OSMData {
    return trimOSMDataByWay(data, (way) => {
        const tags = way.tags ?? {};
        if (!isAccessible(profile, tags)) return null;

        const oneway = resolveModeOneway(profile, tags);
        if (oneway === undefined || oneway === tags.oneway) return way;
        // 元のデータ (キャッシュと共有) を書き換えないよう、タグを複製してから置き換える
        return { ...way, tags: { ...tags, oneway } };
    });
}

export function trimOSMDataByWayHighway(data: App.OSMData, wayHighway: string[]): App.OSMData {
    return trimOSMDataByWay(data, (way) => {
        const highwayTag = way?.tags?.highway;
        if (!highwayTag) {
            return null;
        }
        if (!wayHighway.includes(highwayTag)) {
            return null;
        }
        return way;
    });
}
