/**
 * tome-feature-watch — Tome feature plugin for the Galaxy Watch companion.
 *
 * Session state is LOCAL to this module (deliberately independent from core's
 * remote feature sessions — plugin modules get their own copy of `tome` in
 * node_modules and cannot share core's in-memory token map).
 *
 * Endpoints:
 *   POST /api/watch/create          { }                      -> { token }
 *   POST /api/watch/:token          { action: "next"|"prev"|"scroll-down"|"scroll-up" }
 *   GET  /watch/:token              (controller page — phone/watch can also use plain HTTP)
 *   WS   /ws/watch/:token?role=reader|controller             -> broadcasts actions
 *
 * Load with:
 *   bun add tome-feature-watch
 *   TOME_PLUGINS=tome-feature-watch
 */
import type { Feature } from "tome";
import { watchFeature } from "./feature";

export { watchFeature as feature };
