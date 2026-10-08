import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type RawBootRecord, type PerfMeasurement, type RawRequestRecord, type LogLine, isRawBootRecord, isRawRequestRecord, isLogLine } from ".";
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
CREATE INDEX IF NOT EXISTS idx_log_lines_request_id ON log_lines(request_id);
CREATE INDEX IF NOT EXISTS idx_log_lines_logged_at ON log_lines(logged_at);
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

    const logsByRequest = getLogsByRequest(database, bootId);

    let result: RawRequestRecord[] = [];

    for (const rawRow of res) {
        const row = {
            id: rawRow.id,
            requestedAt: rawRow.requested_at,
            bootId: rawRow.boot_id,
            method: rawRow.method,
            url: rawRow.url,
            perf: rawRow.perf,
            logs: logsByRequest.get(String(rawRow.id)) ?? [],
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

function getLogsByRequest(database: DatabaseSync, bootId?: string) {
    const logsByRequest = new Map<string, LogLine[]>();

    const query = bootId
        ? database.prepare("SELECT l.request_id, l.logged_at, l.log FROM log_lines l JOIN requests r ON r.id = l.request_id WHERE r.boot_id == ? ORDER BY l.logged_at ASC").all(bootId)
        : database.prepare("SELECT request_id, logged_at, log FROM log_lines ORDER BY logged_at ASC").all();
    for (const rawRow of query) {
        const line = { loggedAt: rawRow.logged_at, log: rawRow.log };
        if (!isLogLine(line)) {
            throw new Error("typeof log_lines must be LogLine");
        }
        const requestId = String(rawRow.request_id);
        const lines = logsByRequest.get(requestId);
        if (lines === undefined) {
            logsByRequest.set(requestId, [line]);
        } else {
            lines.push(line);
        }
    }

    return logsByRequest;
}

/**
 * requests の行を先に作る。
 * log_lines の request_id がこの id を参照するため、log の保存より先に必要になる。
 * performance は計測中のプレースホルダーで、finishRequest が上書きする。
 */
export function insertRequest(
    requestedAt: Date,
    method: string,
    url: string,
    start: number
): string | undefined {
    const init = ensureDatabaseInitialized();
    if (!init) return undefined;
    const { database, bootId } = init;

    const id = randomUUID();
    const query = database.prepare("INSERT INTO requests (id, requested_at, boot_id, method, url, performance) VALUES (?, ?, ?, ?, ?, jsonb(?))");
    query.run(id, Math.floor(requestedAt.getTime()), bootId, method, url, JSON.stringify({ entries: [], start, end: start }));

    return id;
}

export function insertLogLine(requestId: string, log: string) {
    const init = ensureDatabaseInitialized();
    if (!init) return;
    const { database } = init;

    const query = database.prepare("INSERT INTO log_lines (id, logged_at, request_id, log) VALUES (?, ?, ?, ?)");
    query.run(randomUUID(), Date.now(), requestId, log);
}

export function finishRequest(requestId: string, performance: PerfMeasurement) {
    const init = ensureDatabaseInitialized();
    if (!init) return;
    const { database } = init;

    const query = database.prepare("UPDATE requests SET performance = jsonb(?) WHERE id = ?");
    query.run(JSON.stringify(performance), requestId);
}
