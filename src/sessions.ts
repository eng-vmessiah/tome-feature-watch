/**
 * Watch-remote sessions — independent token map (see index.ts for rationale).
 * Mirrors core remote/sessions.ts semantics with scroll actions added.
 */
import type { ServerWebSocket } from "bun";

export type WatchRole = "reader" | "controller";

export type WatchWsData = {
  token: string;
  role: WatchRole;
  connectedAt: number;
};

type WatchSession = {
  token: string;
  createdAt: number;
  readers: Set<ServerWebSocket<WatchWsData>>;
};

const tokenToSession = new Map<string, WatchSession>();

/** Sessions idle for > 12h are evicted and their sockets closed. */
const SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 16; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

export function createWatchSession(): string {
  pruneExpired();
  const token = generateToken();
  tokenToSession.set(token, {
    token,
    createdAt: Date.now(),
    readers: new Set(),
  });
  return token;
}

export function isValidToken(token: string): boolean {
  return tokenToSession.has(token);
}

export function registerReader(
  ws: ServerWebSocket<WatchWsData>,
  token: string
): boolean {
  const session = tokenToSession.get(token);
  if (!session) return false;
  session.readers.add(ws);
  return true;
}

export function unregisterReader(ws: ServerWebSocket<WatchWsData>): void {
  const session = tokenToSession.get(ws.data.token);
  if (session) session.readers.delete(ws);
}

const VALID_ACTIONS = new Set(["next", "prev", "scroll-down", "scroll-up"]);

export function dispatchAction(token: string, action: string): number {
  const session = tokenToSession.get(token);
  if (!session) return 404;
  if (!VALID_ACTIONS.has(action)) return 400;
  const json = JSON.stringify({ action });
  for (const ws of session.readers) {
    try {
      ws.send(json);
    } catch {}
  }
  return 200;
}

function pruneExpired(): void {
  const now = Date.now();
  for (const [token, session] of tokenToSession) {
    if (now - session.createdAt > SESSION_MAX_AGE_MS) {
      for (const ws of session.readers) {
        try {
          ws.close(1000, "Session expired");
        } catch {}
      }
      tokenToSession.delete(token);
    }
  }
}
