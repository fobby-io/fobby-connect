// Node-only ways to get a Db: Postgres from a URL (Neon, any Postgres) or PGlite (tests, local without a URL).
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { pgDb, type Db } from "./db.ts";

const migrationsFolder = new URL("../../drizzle", import.meta.url).pathname.replace(/^\/(\w:)/, "$1");

/** In memory without dir; migrated before it is returned. */
export async function pgliteDb(dir?: string): Promise<Db> {
  const d = drizzlePglite(new PGlite(dir));
  await migratePglite(d, { migrationsFolder });
  return pgDb(d);
}

/** Migrations need a direct (unpooled) connection; pass migrate: false for a pooled one. */
export async function urlDb(url: string, o: { migrate?: boolean } = {}): Promise<Db> {
  const d = drizzlePg(new pg.Pool({ connectionString: url, max: 5 }));
  if (o.migrate !== false) await migratePg(d, { migrationsFolder });
  return pgDb(d);
}

/** A Db usable at once while the real one still starts (tests build apps synchronously). */
export const lazyDb = (p: Promise<Db>): Db =>
  new Proxy({} as Db, { get: (_, k) => async (...a: unknown[]) => ((await p) as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string]!(...a) });
