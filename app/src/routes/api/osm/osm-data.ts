import { boundaryContains, type Boundary } from "./boundary";
import { isAccessible, resolveModeOneway, type ModeProfile } from "$lib/mode_profiles";
import { deltaLatitude, deltaLongitude } from "./grid";



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
 * @returns lat/lng でグリッド分けされた OSMData
 */
export function SplitOSMData(data: App.OSMData): { lat: number, lng: number, map: App.OSMData }[] {
    let result: {
        [key: string]: {
            lat: number,
            lng: number,
            map: App.OSMData,
            outputNodes: Set<number>;
            savedNodes: Set<number>;
        }
    } = {}
    const deriveResKey = (lat: number, lon: number) => `${lat}-${lon}`;

    for (const element of data.elements) {
        if (element.type !== "node") continue;

        const lat = Math.floor(element.lat / deltaLatitude);
        const lng = Math.floor(element.lon / deltaLongitude);
        const key = deriveResKey(lat, lng);

        if (result[key] === undefined) {
            result[key] = {
                lat: lat * deltaLatitude,
                lng: lng * deltaLongitude,
                map: {
                    elements: []
                },
                outputNodes: new Set(),
                savedNodes: new Set()
            }
        }
        result[key]?.savedNodes.add(element.id);
        result[key]?.outputNodes.add(element.id);
    }

    for (const element of data.elements) {
        if (element.type !== "way") continue;

        for (const chunkKey of Object.keys(result)) {
            const chunk = result[chunkKey];
            if (element.nodes.every(nodeId => !chunk.savedNodes.has(nodeId))) {
                continue;
            }
            chunk.map.elements.push(element);

            for (const nodeId of element.nodes) {
                chunk.outputNodes.add(nodeId);
            }
        }
    }

    for (const element of data.elements) {
        if (element.type !== "node") continue;

        for (const chunkKey of Object.keys(result)) {
            const chunk = result[chunkKey];
            if (!chunk.outputNodes.has(element.id)) {
                continue;
            }

            chunk.map.elements.push(element);
        }
    }

    return Object.values(result);
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
