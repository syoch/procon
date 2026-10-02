import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { DatabaseSync } from "node:sqlite";

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
    const bootedAt = Math.floor(Date.now() / 1000);
    query.run(bootId, HEAD_HASH, bootedAt);

    initialization = {bootId: bootId};

    return initialization;
}

export function getBoots() {
    ensureDatabaseInitialized();

    const query = database.prepare("SELECT id, head_hash, booted_at from boots");
    let result: {
        id: string,
        headHash: string,
        bootedAt: Date
    }[] = [];

    for (const row of query.all()) {
        if (typeof row.id !== "string") throw new Error("typeof boots.id must be string");
        if (typeof row.head_hash !== "string") throw new Error("typeof boots.head_hash must be string");
        if (typeof row.booted_at !== "number") throw new Error("typeof boots.booted_at must be number");

        result.push({
            id: row.id,
            headHash: row.head_hash,
            bootedAt: new Date(row.booted_at * 1000)
        });
    }

    return result
}

export function getRequests(bootId?: string) {
    ensureDatabaseInitialized();

    const res = bootId ? database.prepare("SELECT id from requests WHERE boot_id == ?").all(bootId)
        : database.prepare("SELECT id from requests").all();
    let result: string[] = [];

    for (const row of res) {
        if (typeof row.id !== "string") throw new Error("typeof boots.id must be string");

        result.push(row.id);
    }

    return result
}

export function saveRequest(
    requestedAt: Date,
    method: string,
    url: string,
    performance: { name: string; startTime: number; endTime: number; }[]
) {
    const {bootId} = ensureDatabaseInitialized();
    const id = randomUUID();
    
    const query = database.prepare("INSERT INTO requests (id, requested_at, boot_id, method, url, performance) VALUES (?, ?, ?, ?, ?, jsonb(?))");
    query.run(id, Math.floor(requestedAt.getTime() / 1000), bootId, method, url, JSON.stringify(performance));
}