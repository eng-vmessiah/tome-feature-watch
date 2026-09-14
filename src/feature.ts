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
  isPaired,
  pairedTo,
  pairTokenWithUser,
  shortCode,
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

  if (path === "/api/watch/create" && method === "GET") {
    // convenient: watch app can GET too
    const token = createWatchSession();
    return new Response(JSON.stringify({ token }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const statusMatch = path.match(/^\/api\/watch\/([a-z0-9]+)\/status$/);
  if (statusMatch && method === "GET") {
    const token = statusMatch[1];
    return new Response(
      JSON.stringify({ paired: isPaired(token) ? pairedTo(token) : null, short: shortCode(token) ?? null }),
      { status: isValidToken(token) ? 200 : 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const confirmMatch = path.match(/^\/api\/watch\/([a-z0-9]+)\/confirm$/);
  if (confirmMatch && method === "POST") {
    const token = confirmMatch[1];
    if (!isValidToken(token)) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    if (ctx.userId === "anonymous") {
      return new Response(JSON.stringify({ error: "login required to pair" }), {
        status: 401, headers: { "Content-Type": "application/json" },
      });
    }
    const ok = pairTokenWithUser(token, ctx.userId);
    return new Response(JSON.stringify({ ok, user: ctx.userId }), {
      status: ok ? 200 : 400, headers: { "Content-Type": "application/json" },
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

function pairPage(token: string, short: string, user: string | null): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pair Watch</title>
<style>body{font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}
.c{text-align:center;padding:2rem}.c h1{font-size:1.3rem;color:#c9b86e}
.b{font-size:2.6rem;letter-spacing:.2em;margin:1rem 0;font-weight:700;color:#eee}
button{font-size:1.15rem;padding:.9rem 2rem;border:0;border-radius:14px;background:#1c4021;color:#7ee08a;font-weight:700}
.m{color:#888;font-size:.9rem}</style></head>
<body><div class="c">
<h1>⚠ Vincular este Galaxy Watch?</h1>
<div class="b">${short}</div>
<div class="m">Confirme o código para o seu server</div>
${user === null
  ? `<div class="m">⛔ Não logado — faça login no Tome e escaneie novamente.</div>`
  : `<button onclick="confirm_()">✓ Vincular com ${user}</button>`}
<script>
function confirm_() {
  fetch('/api/watch/${token}/confirm', { method: 'POST', credentials: 'same-origin' })
    .then(r => r.json()).then(d => {
      if (d.ok) { document.body.innerHTML = '<div class="c"><h1>✓ Watch vinculado!</h1><div class="m">Pode usar no relógio agora.</div></div>'; }
      else alert(d.error || 'erro');
    });
}
</script></div></body></html>`;
}

async function pageRoutes(ctx: FeatureRouteContext): Promise<Response | null> {
  const { req, path } = ctx;

  const pairMatch = path.match(/^\/watch\/pair\/([a-z0-9]+)$/);
  if (pairMatch && req.method === "GET") {
    const token = pairMatch[1];
    if (!isValidToken(token)) return null; // fall-through 404
    const sc = shortCode(token) ?? "——-——";
    return new Response(pairPage(token, sc, ctx.userId === "anonymous" ? null : ctx.userId), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

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
