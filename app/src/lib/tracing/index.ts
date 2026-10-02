export type PerfMeasurement = {
    entries: {
        name: string,
        startTime: number,
        endTime: number,
    }[],
    start: number,
    end: number
};

export function isPerfMeasurement(perf: any): perf is PerfMeasurement {
    if (typeof perf !== "object") {
        return false;
    }
    if (!(perf.entries instanceof Array)) {
        return false;
    }
    for (const elem of perf.entries) {
        if (typeof elem.name !== "string")
            return false;
        if (typeof elem.startTime !== "number")
            return false;
        if (typeof elem.endTime !== "number")
            return false;
    }
    if (typeof perf.start !== "number")
        return false;
    if (typeof perf.end !== "number")
        return false;

    return true;
}

export type RawBootRecord = {
    id: string,
    headHash: string,
    bootedAt: number
};
export function isRawBootRecord(info: any): info is RawBootRecord {
    if (typeof info !== "object") return false;

    if (typeof info.id !== "string") return false;
    if (typeof info.bootedAt !== "number") return false;
    if (typeof info.headHash !== "string") return false;

    return true;
}

export type BootRecord = {
    id: string,
    headHash: string,
    bootedAt: Date
};

export type RawRequestRecord = {
    id: string
    requestedAt: number
    bootId: string
    method: string
    url: string
    perf: PerfMeasurement
};
export function isRawRequestRecord(info: any): info is RawRequestRecord {
    if (typeof info !== "object") return false;

    if (typeof info.id !== "string") return false;
    if (typeof info.requestedAt !== "number") return false;
    if (typeof info.bootId !== "string") return false;
    if (typeof info.method !== "string") return false;
    if (typeof info.url !== "string") return false;
    if (!isPerfMeasurement(info.perf)) return false;

    return true;
}

export type RequestRecord = {
    id: string
    requestedAt: Date
    bootId: string
    method: string
    url: string
    perf: PerfMeasurement
};