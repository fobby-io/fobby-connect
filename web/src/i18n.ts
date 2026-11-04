// Two languages in the code; the screen shows English only for now (there is no switch), and the Chinese texts stay so
// a switch can come back. Components call useLang() so a switch re-renders them; t() then reads the current language.
// Server messages are mapped by error code in api.ts.
import { useSyncExternalStore } from "react";

export type Lang = "zh" | "en";
const KEY = "lang";
// Tests import diff.ts under Node (no DOM lib there): they get Chinese, the language the test texts are written in.
const g = globalThis as {
  document?: { documentElement: { lang: string } };
  localStorage?: { getItem(k: string): string | null; setItem(k: string, v: string): void };
};
const read = (): Lang => (g.document ? "en" : "zh");
let lang: Lang = read();
const subs = new Set<() => void>();
const mark = (l: Lang) => { if (g.document) g.document.documentElement.lang = l === "zh" ? "zh-Hant" : "en"; };
mark(lang);

export const getLang = () => lang;
export function setLang(l: Lang) {
  lang = l;
  try { g.localStorage?.setItem(KEY, l); } catch { /* per-viewer convenience only */ }
  mark(l);
  subs.forEach((f) => f());
}
export function useLang(): Lang {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, getLang, getLang);
}
export const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
