import type { Boundary } from "./boundary";

export type OSMRawWay = {
    type: "way";
    id: number;
    nodes: number[];
    tags: Record<string, string>;
}

export type OSMRawNode = {
    type: "node";
    id: number;
    lat: number;
    lon: number;
};

export type OSMData = {
    elements: (OSMRawWay | OSMRawNode)[]
};

export function mergeOSMData(data: OSMData, other: OSMData) {
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

export function trimOSMData(data: OSMData, boundary: Boundary): OSMData {
    const trimmedData: OSMData = {
        elements: []
    };

    const outputNodes = new Set<number>();
    const savedNodes = new Set<number>();
    for (const element of data.elements) {
        if (element.type !== "node") continue;

        if (element.lat < boundary.minLat || element.lat > boundary.maxLat
            || element.lon < boundary.minLng || element.lon > boundary.maxLng) {
            continue;
        }

        trimmedData.elements.push(element);
        savedNodes.add(element.id);
        outputNodes.add(element.id);
    }

    for (const element of data.elements) {
        if (element.type !== "way") continue;

        if (element.nodes.every(nodeId => !savedNodes.has(nodeId))) {
            continue;
        }

        trimmedData.elements.push(element);

        for (const nodeId of element.nodes) {
            if (savedNodes.has(nodeId)) continue;
            if (outputNodes.has(nodeId)) continue;

            const node = data.elements.find(e => e.type === "node" && e.id === nodeId) as OSMRawNode | undefined;
            if (!node) continue;

            trimmedData.elements.push(node);
            outputNodes.add(nodeId);
        }
    }

    return trimmedData;
}