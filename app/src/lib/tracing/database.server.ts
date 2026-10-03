import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type RawBootRecord, type PerfMeasurement, type RawRequestRecord, isRawBootRecord, isRawRequestRecord } from ".";
import { env } from "$env/dynamic/private";

function getDatabaseLocator(): string | undefined {
    return env.DATABASE_LOCATOR;
}

type Init = {
    bootId: string,
    database: DatabaseSync
};

/**
 * 起動したビルドの git commit。
 * @ref infra/README.md
 */
const HEAD_HASH = env.PROCON_HEAD_HASH || "no-git";
let initialization: Init | undefined = undefined

const SQL_INIT = `
CREATE TABLE IF NOT EXISTS boots(
    id TEXT PRIMARY KEY, -- uuid
    head_hash TEXT,
    booted_at INTEGER
);
CREATE TABLE IF NOT EXISTS requests(
    id TEXT PRIMARY KEY, -- uuid
    requested_at INTEGER,
    boot_id TEXT,
    method TEXT,
    url TEXT,
    performance BLOB, -- JSONB, RequestContext で収集できるもの

    FOREIGN KEY(boot_id) REFERENCES boots(id)
);
CREATE TABLE IF NOT EXISTS log_lines(
    id TEXT PRIMARY KEY, -- uuid
    logged_at INTEGER,
    request_id TEXT,
    log TEXT,

    FOREIGN KEY(request_id) REFERENCES requests(id)
);
CREATE INDEX IF NOT EXISTS idx_requests_boot_id ON requests(boot_id);
CREATE INDEX IF NOT EXISTS idx_requests_requested_at ON requests(requested_at DESC);
`

export function isTracingEnabled(): boolean {
    const db_locator = getDatabaseLocator();
    return Boolean(db_locator);
}

function ensureDatabaseInitialized(): Init | undefined {
    if (initialization !== undefined) {
        return initialization;
    }

    const db_locator = getDatabaseLocator();
    if (!db_locator) {
        return undefined;
    }

    const database = new DatabaseSync(db_locator);
    database.exec(SQL_INIT);

    const boot = database.prepare("INSERT INTO boots (id, head_hash, booted_at) VALUES (?, ?, ?)");
    const bootId = randomUUID();
    const bootedAt = Math.floor(Date.now());
    boot.run(bootId, HEAD_HASH, bootedAt);

    initialization = { bootId: bootId, database };

    return initialization;
}

export function getBoots(sort?: "asc" | "desc") {
    const init = ensureDatabaseInitialized();
    if (!init) return []
    const database = init.database;

    const queryStmt = "SELECT id, head_hash, booted_at from boots";
    const sortClause = sort === "asc"
        ? "ORDER BY booted_at ASC"
        : sort === "desc"
            ? "ORDER BY booted_at DESC"
            : "";

    const query = database.prepare(`${queryStmt} ${sortClause}`);
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

export function getRequests(bootId?: string, sort?: "asc" | "desc") {
    const init = ensureDatabaseInitialized();
    if (!init) return []
    const database = init.database;

    const queryStmt = "SELECT id, requested_at, boot_id, method, url, json_quote(performance) AS perf from requests";
    const sortClause = sort === "asc"
        ? "ORDER BY requested_at ASC"
        : sort === "desc"
            ? "ORDER BY requested_at DESC"
            : "";

    const res = bootId
        ? database.prepare(`${queryStmt} WHERE boot_id == ? ${sortClause}`).all(bootId)
        : database.prepare(`${queryStmt} ${sortClause}`).all();

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
    const init = ensureDatabaseInitialized();
    if (!init) return []
    const { database, bootId } = init;

    const id = randomUUID();

    const query = database.prepare("INSERT INTO requests (id, requested_at, boot_id, method, url, performance) VALUES (?, ?, ?, ?, ?, jsonb(?))");
    query.run(id, Math.floor(requestedAt.getTime()), bootId, method, url, JSON.stringify(performance));
}
