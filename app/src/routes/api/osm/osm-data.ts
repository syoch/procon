import { boundaryContains, type Boundary } from "./boundary";



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

export function trimOSMDataByWayHighway(data: App.OSMData, wayHighway: string[]): App.OSMData {
    const trimmedData: App.OSMData = {
        elements: []
    };

    const savedNodes = new Set<number>();
    for (const element of data.elements) {
        if (element.type !== "way") continue;

        const highwayTag = element?.tags?.highway;
        if (!highwayTag) {
            continue;
        }
        if (!wayHighway.includes(highwayTag)) {
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
