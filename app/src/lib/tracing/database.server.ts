import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type RawBootRecord, type PerfMeasurement, type RawRequestRecord, isRawBootRecord, isRawRequestRecord } from ".";

type Init = {
    bootId: string
};


// TODO: いったん memory にしている。後で環境変数でパスを注入できるようにする
const database = new DatabaseSync(":memory:")
const HEAD_HASH = "Dummy-HEAD";
let initialization: Init | undefined = undefined

const TABLES = [
    {
        name: "boots",
        query: `CREATE TABLE boots(
    id TEXT PRIMARY KEY, -- uuid
    head_hash TEXT,
    booted_at INTEGER
);`,
    },
    {
        name: "requests",
        query: `CREATE TABLE requests(
    id TEXT PRIMARY KEY, -- uuid
    requested_at INTEGER,
    boot_id TEXT,
    method TEXT,
    url TEXT,
    performance BLOB, -- JSONB, RequestContext で収集できるもの

    FOREIGN KEY(boot_id) REFERENCES boots(id)
);`
    },
    {
        name: "log_lines",
        query: `CREATE TABLE log_lines(
    id TEXT PRIMARY KEY, -- uuid
    logged_at INTEGER,
    request_id TEXT,
    log TEXT,

    FOREIGN KEY(request_id) REFERENCES requests(id)
);`
    }
]

function getAvailableTables() {
    const query = database.prepare("SELECT tbl_name from sqlite_master WHERE type == 'table'");

    let tables_created: string[] = []
    for (const result of query.all()) {
        for (const key of Object.keys(result)) {
            const value = result[key];

            if (typeof value !== "string")
                throw new Error("Invalid sqlite_master.tbl_name type");

            tables_created.push(value);
        }
    }

    return tables_created;
}

function ensureDatabaseInitialized(): Init {
    if (initialization !== undefined) {
        return initialization;
    }

    console.log("init() called");

    let tables_created = getAvailableTables();
    for (const table of TABLES) {
        if (!tables_created.includes(table.name)) {
            database.exec(table.query);
        }
    }

    const query = database.prepare("INSERT INTO boots (id, head_hash, booted_at) VALUES (?, ?, ?)");
    const bootId = randomUUID();
    const bootedAt = Math.floor(Date.now());
    query.run(bootId, HEAD_HASH, bootedAt);

    initialization = { bootId: bootId };

    return initialization;
}

export function getBoots() {
    ensureDatabaseInitialized();

    const query = database.prepare("SELECT id, head_hash, booted_at from boots");
    let result: RawBootRecord[] = [];

    for (const rawRow of query.all()) {
        const row = {
            id: rawRow.id,
            headHash: rawRow.head_hash,
            bootedAt: rawRow.booted_at,
        }
        if (!isRawBootRecord(row)) throw new Error("typeof boots must be RawBootInfo");
        result.push(row);
    }

    return result
}

export function getRequests(bootId?: string) {
    ensureDatabaseInitialized();

    const res = bootId ? database.prepare("SELECT id, requested_at, boot_id, method, url, json_quote(performance) AS perf from requests WHERE boot_id == ?").all(bootId)
        : database.prepare("SELECT id, requested_at, boot_id, method, url, json_quote(performance) AS perf from requests").all();
    let result: RawRequestRecord[] = [];

    for (const rawRow of res) {
        const row = {
            id: rawRow.id,
            requestedAt: rawRow.requested_at,
            bootId: rawRow.boot_id,
            method: rawRow.method,
            url: rawRow.url,
            perf: rawRow.perf,
        }

        if (typeof row.perf !== "string") {
            throw new Error("typeof requests.perf must be string");
        }
        row.perf = JSON.parse(row.perf);

        if (!isRawRequestRecord(row)) {
            throw new Error("typeof requests must be RawRequestInfo");
        }

        result.push(row)
    }

    return result
}

export function saveRequest(
    requestedAt: Date,
    method: string,
    url: string,
    performance: PerfMeasurement
) {
    const { bootId } = ensureDatabaseInitialized();
    const id = randomUUID();

    const query = database.prepare("INSERT INTO requests (id, requested_at, boot_id, method, url, performance) VALUES (?, ?, ?, ?, ?, jsonb(?))");
    query.run(id, Math.floor(requestedAt.getTime()), bootId, method, url, JSON.stringify(performance));
}