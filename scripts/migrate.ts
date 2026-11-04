// Applies drizzle/ migrations to the Postgres in DATABASE_URL. Use a direct (unpooled) URL.
// Run: DATABASE_URL=<direct url> npx tsx scripts/migrate.ts
import { urlDb } from "../src/server/pg-node.ts";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
await urlDb(process.env.DATABASE_URL);
console.log("migrations applied");
process.exit(0);
