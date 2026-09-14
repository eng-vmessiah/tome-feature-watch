/**
 * Watch-remote sessions — metadata in sqlite (survives restarts: pair once),
 * live reader sockets in memory (re-registered by the phone on each page load).
 * Mirrors core remote/sessions.ts semantics with scroll actions added.
 */
import type { ServerWebSocket } from "bun";
import { Database } from "bun:sqlite";
import { DB_PATH } from "tome";

export type WatchRole = "reader" | "controller";

export type WatchWsData = {
  token: string;
  role: WatchRole;
  connectedAt: number;
};

/** Live reader sockets only — re-registered via WS on every page load. */
const readers = new Map<string, Set<ServerWebSocket<WatchWsData>>>();

/** Sessions idle this long are evicted (sliding window, refreshed on use). */
const IDLE_EVICT_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

function getDb(): Database {
  return new Database(DB_PATH);
}

type SessionRow = {
  token: string;
  shortCode: string;
  pairedTo: string | null;
  createdAt: number;
  lastSeenAt: number;
};

function getRow(token: string): SessionRow | null {
  const db = getDb();
  try {
    return (
      (db
        .query(`SELECT * FROM "watch_sessions" WHERE token = ?`)
        .get(token) as SessionRow | null) ?? null
    );
  } finally {
    db.close();
  }
}

function touch(token: string): void {
  const db = getDb();
  try {
    db.run(`UPDATE "watch_sessions" SET lastSeenAt = ? WHERE token = ?`, [
      Date.now(),
      token,
    ]);
  } finally {
    db.close();
  }
}

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 16; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function genShort(): string {
  const digits = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) out += digits[Math.floor(Math.random() * digits.length)];
  return out.slice(0, 3) + "-" + out.slice(3);
}

function shortTaken(short: string): boolean {
  const db = getDb();
  try {
    return !!db
      .query(`SELECT 1 FROM "watch_sessions" WHERE shortCode = ?`)
      .get(short);
  } finally {
    db.close();
  }
}

export function shortCode(token: string): string | null {
  return getRow(token)?.shortCode ?? null;
}

export function isPaired(token: string): boolean {
  return !!getRow(token)?.pairedTo;
}

export function pairedTo(token: string): string | null {
  return getRow(token)?.pairedTo ?? null;
}

export function createWatchSession(): string {
  pruneExpired();
  const db = getDb();
  try {
    let token = generateToken();
    while (
      db.query(`SELECT 1 FROM "watch_sessions" WHERE token = ?`).get(token)
    ) {
      token = generateToken();
    }
    let short = genShort();
    let guard = 0;
    while (shortTaken(short) && guard++ < 10) short = genShort();
    const now = Date.now();
    db.run(
      `INSERT INTO "watch_sessions" (token, shortCode, pairedTo, createdAt, lastSeenAt)
       VALUES (?, ?, NULL, ?, ?)`,
      [token, short, now, now]
    );
    return token;
  } finally {
    db.close();
  }
}

export function isValidToken(token: string): boolean {
  return !!getRow(token);
}

export function pairTokenWithUser(token: string, userId: string): boolean {
  const row = getRow(token);
  if (!row) return false;
  if (row.pairedTo && row.pairedTo !== userId) return false;
  const db = getDb();
  try {
    db.run(
      `UPDATE "watch_sessions" SET pairedTo = ?, lastSeenAt = ? WHERE token = ?`,
      [userId, Date.now(), token]
    );
  } finally {
    db.close();
  }
  // notify waiting readers
  const json = JSON.stringify({ paired: userId });
  for (const ws of readers.get(token) ?? []) {
    try {
      ws.send(json);
    } catch {}
  }
  return true;
}

/**
 * Burn a session (Unpair). Anyone holding the token may burn it; a logged-in
 * user may also burn a session paired to them. Returns "ok" | "forbidden" | "missing".
 */
export function revokeSession(
  token: string,
  opts: { bearer: boolean; userId: string }
): "ok" | "forbidden" | "missing" {
  const row = getRow(token);
  if (!row) return "missing";
  const owner = row.pairedTo === null || row.pairedTo === opts.userId;
  if (!opts.bearer && (opts.userId === "anonymous" || !owner)) return "forbidden";
  const db = getDb();
  try {
    db.run(`DELETE FROM "watch_sessions" WHERE token = ?`, [token]);
  } finally {
    db.close();
  }
  for (const ws of readers.get(token) ?? []) {
    try {
      ws.close(1000, "Session revoked");
    } catch {}
  }
  readers.delete(token);
  return "ok";
}

export function registerReader(
  ws: ServerWebSocket<WatchWsData>,
  token: string
): boolean {
  if (!getRow(token)) return false;
  let set = readers.get(token);
  if (!set) {
    set = new Set();
    readers.set(token, set);
  }
  set.add(ws);
  return true;
}

export function unregisterReader(ws: ServerWebSocket<WatchWsData>): void {
  const set = readers.get(ws.data.token);
  if (set) set.delete(ws);
}

const VALID_ACTIONS = new Set(["next", "prev", "scroll-down", "scroll-up"]);

export function dispatchAction(token: string, action: string): number {
  if (!getRow(token)) return 404;
  if (!VALID_ACTIONS.has(action)) return 400;
  touch(token);
  const json = JSON.stringify({ action });
  for (const ws of readers.get(token) ?? []) {
    try {
      ws.send(json);
    } catch {}
  }
  return 200;
}

function pruneExpired(): void {
  const db = getDb();
  try {
    db.run(`DELETE FROM "watch_sessions" WHERE lastSeenAt < ?`, [
      Date.now() - IDLE_EVICT_MS,
    ]);
  } finally {
    db.close();
  }
}
