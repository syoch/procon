import { boundaryContains, type Boundary } from "./boundary";

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

    const trimmedData: OSMData = {
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

export function trimOSMDataByWayHighway(data: OSMData, wayHighwayExcludes: string[]): OSMData {
    const trimmedData: OSMData = {
        elements: []
    };

    const savedNodes = new Set<number>();
    for (const element of data.elements) {
        if (element.type !== "way") continue;

        const highwayTag = element?.tags?.highway;
        if (!highwayTag) {
            continue;
        }
        if (wayHighwayExcludes.includes(highwayTag)) {
            continue;
        }

        trimmedData.elements.push(element);

        for (const nodeId of element.nodes) {
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
