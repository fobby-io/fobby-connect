/** Default party split: the first printed line is the name, the rest is the address. */
export function splitParty(raw: string): { name: string; address: string } {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { name: lines[0] ?? "", address: lines.slice(1).join("\n") };
}

/** Split by a literal separator into at most `n` parts. */
export function splitLiteral(raw: string, separator: string, n: number): string[] {
  const parts = raw.split(separator);
  return [...parts.slice(0, n - 1), parts.slice(n - 1).join(separator)].map((p) => p.trim());
}
