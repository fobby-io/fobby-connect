// One Postgres connection for one request, for hosts that pool in front of the database; no Node built-ins needed.
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { pgDb, type Db } from "./db.ts";

/** Call end() when the request is done. */
export async function clientDb(url: string): Promise<{ db: Db; end: () => Promise<void> }> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  return { db: pgDb(drizzle(c)), end: () => c.end() };
}
