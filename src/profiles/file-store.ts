import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { memoryStore, type Store } from "./loop.ts";

// shortcut: one JSON file, rewritten on every change; fine for one local user, replace with Postgres (M5) for teams.
export function fileStore(path: string): Store {
  const init = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const m = memoryStore(init);
  const save = () => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(m.dump())); };
  return {
    versions: m.versions,
    approved: m.approved,
    senders: m.senders,
    put: (v) => { m.put(v); save(); },
    addApproved: (a) => { m.addApproved(a); save(); },
  };
}
