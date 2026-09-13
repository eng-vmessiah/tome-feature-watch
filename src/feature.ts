/**
 * Feature wiring — routes + WS for the watch control plane.
 */
import type {
  Feature,
  FeatureRouteContext,
  FeatureWsPath,
} from "tome";
import {
  createWatchSession,
  dispatchAction,
  isValidToken,
  registerReader,
  unregisterReader,
  type WatchRole,
  type WatchWsData,
} from "./sessions";

// ---------------------------------------------------------------
// API routes
// ---------------------------------------------------------------
async function apiRoutes(ctx: FeatureRouteContext): Promise<Response | null> {
  const { req, path } = ctx;
  const method = req.method;

  if (path === "/api/watch/create" && method === "POST") {
    const token = createWatchSession();
    return new Response(JSON.stringify({ token }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const actionMatch = path.match(/^\/api\/watch\/([a-z0-9]+)$/);
  if (actionMatch && method === "POST") {
    const token = actionMatch[1];
    if (!isValidToken(token)) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    let action: string | undefined;
    try {
      const body = (await req.json()) as { action?: string };
      action = body.action;
    } catch {
      // fallthrough — missing body handled below
    }
    if (!action) {
      return new Response(JSON.stringify({ error: "missing action" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const status = dispatchAction(token, action);
    if (status === 404) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (status === 400) {
      return new Response(
        JSON.stringify({
          error: "invalid action (next|prev|scroll-down|scroll-up)",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    return new Response(JSON.stringify({ ok: true, action }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  return null;
}

// ---------------------------------------------------------------
// Controller page (tiny ES5 page usable as a remote from any browser)
// ---------------------------------------------------------------
function controllerPage(token: string, wsScheme: string, host: string): string {
  const wsUrl = `${wsScheme}://${host}/ws/watch/${token}?role=controller`;
  return `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tome Watch</title></head>
<body style="font-family:sans-serif;text-align:center;padding-top:3rem">
<h3>Watch session: ${token.slice(0, 6)}…</h3>
<button onclick="send('next')" style="font-size:2rem;padding:1rem 2rem">▶ Next</button>
<button onclick="send('prev')" style="font-size:2rem;padding:1rem 2rem">◀ Prev</button><br><br>
<button onclick="send('scroll-down')" style="font-size:1.4rem;padding:1rem">↓ Scroll</button>
<button onclick="send('scroll-up')" style="font-size:1.4rem;padding:1rem">↑ Scroll</button>
<script>
var ws = null;
function connect() {
  ws = new WebSocket("${wsUrl}");
  ws.onopen = function() { document.title = "connected"; };
  ws.onclose = function() { setTimeout(connect, 2000); };
}
function send(action) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: action }));
}
connect();
</script></body></html>`;
}

async function pageRoutes(ctx: FeatureRouteContext): Promise<Response | null> {
  const { req, path } = ctx;
  const match = path.match(/^\/watch\/([a-z0-9]+)$/);
  if (match && req.method === "GET") {
    const token = match[1];
    if (!isValidToken(token)) return null; // fall through to 404
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    return new Response(
      controllerPage(token, proto === "https" ? "wss" : "ws", host),
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
  return null;
}

// ---------------------------------------------------------------
// WS path — controllers send actions (like core remote), readers receive.
// ---------------------------------------------------------------
// KNOWN CORE LIMITATION: plugins get their own copy of the `tome` module, so
// getFeatureIndex() inside the plugin queries an empty registry and returns -1
// (verified empirically). The app shell needs the REAL index in ws.data to route
// WS events. Registry order is deterministic: 3 static core features (epub,
// remote, ws-test) then plugins in TOME_PLUGINS order. Compute from env.
const CORE_FEATURE_COUNT = 3; // epub, remote, ws-test (see tome/src/registration.ts)

function watchFeatureIndex(): number {
  const plugins = (process.env.TOME_PLUGINS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const pos = plugins.indexOf("tome-feature-watch");
  return CORE_FEATURE_COUNT + (pos >= 0 ? pos : 0);
}
const watchWsPath = {
  match(path: string, url: URL): unknown | null {
    const m = path.match(/^\/ws\/watch\/([a-z0-9]+)$/);
    if (!m) return null;
    const role = url.searchParams.get("role");
    if (role !== "reader" && role !== "controller") return { invalid: true };
    return { token: m[1], role };
  },
  upgrade(req: Request, server: any, params: unknown): Response | undefined {
    const p = params as { token: string; role: string; invalid?: boolean };
    if (p.invalid) return new Response("invalid role", { status: 400 });
    // CRITICAL: the app shell routes WS events by featureIndex/pathIndex.
    // Without these, open/message/close never reach this feature.
    const upgraded = server.upgrade(req, {
      data: {
        featureIndex: watchFeatureIndex(),
        pathIndex: 0,
        params: { token: p.token, role: p.role, connectedAt: Date.now() },
      },
    });
    return upgraded ? undefined : new Response("upgrade failed", { status: 500 });
  },
  open(ws: any, params: unknown): void {
    const p = params as { token: string; role: string };
    if (p.role === "reader") {
      ws.data = { token: p.token, role: "reader", connectedAt: Date.now() };
      if (!registerReader(ws, p.token)) ws.close(1008, "Invalid session");
    }
    // Controllers bridge HTTP POSTs -> WS for standalone testing; in practice
    // the watch companion uses POST /api/watch/:token directly.
  },
  close(ws: any): void {
    if (ws.data?.role === "reader") unregisterReader(ws);
  },
} satisfies Partial<FeatureWsPath>;

export const watchFeature: Feature = {
  name: "watch",
  apiRoutes,
  pageRoutes,
  wsPaths: [watchWsPath as any],
};
