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
  pairedTo: string | null; // userId after web confirm
  shortCode: string;       // 6-char display code for the watch screen
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

function genShort(): string {
  const digits = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  let out = "";
  for (let i = 0; i < 6; i++) out += digits[Math.floor(Math.random() * digits.length)];
  return out.slice(0, 3) + "-" + out.slice(3);
}

export function shortCode(token: string): string | null {
  return tokenToSession.get(token)?.shortCode ?? null;
}

export function pairTokenWithUser(token: string, userId: string): boolean {
  const s = tokenToSession.get(token);
  if (!s) return false;
  if (s.pairedTo) return true; // idempotent
  s.pairedTo = userId;
  const code = s.shortCode;
  // notify waiting readers by sending {paired:"<user>"}: add to VALID_ACTIONS? simpler: dedicated flag
  const json = JSON.stringify({ paired: s.pairedTo });
  for (const ws of s.readers) {
    try { ws.send(json); } catch {}
  }
  return true;
}

export function isPaired(token: string): boolean {
  return !!tokenToSession.get(token)?.pairedTo;
}

export function pairedTo(token: string): string | null {
  return tokenToSession.get(token)?.pairedTo ?? null;
}

export function createWatchSession(): string {
  pruneExpired();
  const token = generateToken();
  tokenToSession.set(token, {
    token,
    createdAt: Date.now(),
    readers: new Set(),
    pairedTo: null,
    shortCode: genShort(),
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
