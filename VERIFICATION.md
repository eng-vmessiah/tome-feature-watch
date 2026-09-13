# Part A — Verification Evidence (2026-09-13)

## Environment
- Server: Tome core clone @ /tmp/tome (bun v1.4.2, port 3997)
- Plugin: `tome-feature-watch` @ ~/project/tome-feature-watch, loaded via `bun add` (file: link) + `TOME_PLUGINS=tome-feature-watch`

## Contract
- `POST /api/watch/create` → `{token}` (16-char lowercase alnum)
- `POST /api/watch/:token` body `{action}` → 200 `{ok:true,action}` | 400 invalid action | 404 invalid token
- Allowed actions: `next`, `prev`, `scroll-down`, `scroll-up`
- `WS /ws/watch/:token?role=reader` receives broadcasts; controller page at `/watch/:token` (fallback UI)

## Evidence (fresh run)
```
create: 200 {'token': '...'}
dispatch no-readers: 200 {'ok': True, 'action': 'next'}
invalid action: 400 {'error': 'invalid action (next|prev|scroll-down|scroll-up)'}
invalid token: 404 {'error': 'invalid token'}
watch page valid: 200
no-token watch page: 404 (core HTML page — fall-through OK)
```
WS broadcast e2e (node client as reader):
```
next           | WS_OPEN MSG:{"action":"next"}    | PASS
scroll-down    | WS_OPEN MSG:{"action":"scroll-down"} | PASS
scroll-up      | WS_OPEN MSG:{"action":"scroll-up"}   | PASS
prev           | WS_OPEN MSG:{"action":"prev"}    | PASS
RESULT: ALL PASS
```

## Bugs found & fixed during verification
1. **WS open never fired (first smoke FAILED 4/4):** handlers `open`/`close` were missing on the wsPath object — upgrade succeeded but no registration happened.
2. **Dual module instance (root cause after fix 1):** `getFeatureIndex("watch")` imported from the plugin's own `tome` copy returns **-1** — plugin's registry module is a separate instance from the server's. Empirically verified with debug log.
   **Fix:** compute index from `TOME_PLUGINS` env order (+3 static core features). Documented in `feature.ts` as `watchFeatureIndex()`. Should be raised upstream: show plugins a way to get their real index (e.g. pass index into `Feature.start(ctx)` or expose registry through a context object).

## NOT verified (out of scope for this wave)
- Real deployment on Nicolas' server (needs his authorization) — NOT READY
- Real watch device (Part B pending)
- Reader-side JS integration with core remote sessions (independent token maps — documented; coexistence design pending Nicolas' input on whether core should expose broadcast hooks)
