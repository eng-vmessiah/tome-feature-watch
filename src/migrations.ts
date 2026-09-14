/**
 * Watch-remote migrations — watch_sessions table (persistent pairings).
 */
import type { Database } from "bun:sqlite";

export function migrateWatch(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS "watch_sessions" (
      "token" TEXT PRIMARY KEY,
      "shortCode" TEXT NOT NULL,
      "pairedTo" TEXT,
      "createdAt" INTEGER NOT NULL,
      "lastSeenAt" INTEGER NOT NULL
    )
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS "idx_watch_sessions_seen"
    ON "watch_sessions" ("lastSeenAt")
  `);
}
