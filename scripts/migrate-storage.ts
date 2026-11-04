// Moves a data folder's JSON state into Postgres (DATABASE_URL, a direct URL) or, without one, the PGlite the local
// server uses. Prints what would move; --apply writes. Safe to run again.
// Run: npx tsx scripts/migrate-storage.ts [--apply]   (DATA_DIR defaults to data/)
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Files } from "../src/server/app.ts";
import { migrateStorage } from "../src/server/migrate-storage.ts";
import { pgliteDb, urlDb } from "../src/server/pg-node.ts";

const DATA = process.env.DATA_DIR ?? "data";
const at = (key: string) => join(DATA, key);
const files: Files = {
  get: async (key) => existsSync(at(key)) ? new Uint8Array(readFileSync(at(key))) : null,
  put: async (key, bytes) => { mkdirSync(dirname(at(key)), { recursive: true }); writeFileSync(at(key), bytes); },
  list: async (prefix) => existsSync(at(prefix)) ? readdirSync(at(prefix)).map((n) => prefix + n) : [],
  delete: async (key) => rmSync(at(key), { force: true }),
};
const db = process.env.DATABASE_URL ? await urlDb(process.env.DATABASE_URL) : await pgliteDb(join(DATA, "pg"));
console.log(JSON.stringify(await migrateStorage(files, db, { apply: process.argv.includes("--apply") }), null, 2));
process.exit(0);
