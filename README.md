# tome-feature-watch

Tome feature plugin — wrist-gesture remote (Galaxy Watch companion), zero core changes.

## Install (server)

```bash
bun add github:eng-vmessiah/tome-feature-watch
echo 'TOME_PLUGINS=tome-feature-watch' >> .env
# restart Tome
```

## Endpoints

| Method | Path | Body |
|---|---|---|
| POST | `/api/watch/create` | — → `{token}` |
| POST | `/api/watch/:token` | `{action}` where action ∈ `next \| prev \| scroll-down \| scroll-up` |
| GET  | `/watch/:token` | controller fallback page (phone browser) |
| WS   | `/ws/watch/:token?role=reader` | receives `{action}` broadcasts |

Creates its own session map (in-memory, 6h TTL) — independent from core `remote` feature.

## Companion app

See [tome-watch-wearable](https://github.com/eng-vmessiah/tome-watch-wearable) — the Galaxy Watch app (gyro flick detector → HTTP POST here).

## Known core limitation

Plugins get their own module instance of `tome`, so `getFeatureIndex()` inside the plugin
returns -1 (empty registry). Index is derived from `TOME_PLUGINS` ordering
(+3 core static features). Worth exposing feature index through the plugin API in core.
