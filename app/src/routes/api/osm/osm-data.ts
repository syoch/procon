import { boundaryContains, type Boundary } from "./boundary";
import { isAccessible, resolveModeOneway, type ModeProfile } from "$lib/mode_profiles";



export function mergeOSMData(data: App.OSMData, other: App.OSMData) {
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
