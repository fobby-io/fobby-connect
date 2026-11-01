import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MetaClient } from "../src/gateway/meta-client.ts";
import { costUsd } from "../src/gateway/models.ts";

const CACHE = "eval/out/cache";

/** Raw model replies cached on disk by request, so a rerun of the same option costs nothing; live calls stop at the cap. */
export function cachedClient(live: MetaClient, maxSpend: number) {
  mkdirSync(CACHE, { recursive: true });
  let spent = 0;
  const client: MetaClient = async (req, signal) => {
    const file = join(CACHE, `${createHash("sha256").update(JSON.stringify(req)).digest("hex")}.json`);
    if (existsSync(file)) return { ...JSON.parse(readFileSync(file, "utf8")), cached: true };
    if (spent >= maxSpend) throw new Error(`spend cap US$${maxSpend} reached`);
    const r = await live(req, signal);
    spent += costUsd(req.model, r.usage);
    writeFileSync(file, JSON.stringify(r));
    return r;
  };
  return { client, spent: () => spent };
}

export async function pool<T>(xs: T[], n: number, f: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < xs.length) await f(xs[i++]!);
  }));
}
