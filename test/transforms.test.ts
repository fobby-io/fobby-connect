import { describe, expect, it } from "vitest";
import { lookupPort } from "../src/reference/unlocode.ts";
import { parseDate } from "../src/transforms/steps/date-parse.ts";
import { parseNumber } from "../src/transforms/steps/parse-number.ts";
import { splitParty } from "../src/transforms/steps/split.ts";
import { toBase, unitIn } from "../src/transforms/units.ts";

describe("stage 2 value steps", () => {
  it("parses numbers by locale", () => {
    expect(parseNumber("1,234.50")).toBe("1234.5");
    expect(parseNumber("1.254,50", { decimal: "," })).toBe("1254.5");
    expect(parseNumber("@ 3.20")).toBe("3.2");
    expect(parseNumber("279 CTNS")).toBe("279");
    expect(parseNumber("N/A")).toBeNull();
  });

  it("parses printed dates including ROC years", () => {
    expect(parseDate("115/10/28")).toBe("2026-10-28");
    expect(parseDate("115年3月5日")).toBe("2026-03-05");
    expect(parseDate("OCT. 30, 2026")).toBe("2026-10-30");
    expect(parseDate("30-OCT-2026")).toBe("2026-10-30");
    expect(parseDate("2026/10/30")).toBe("2026-10-30");
    expect(parseDate("10/30/2026")).toBe("2026-10-30");
    expect(parseDate("30/10/2026", { order: "dmy" })).toBe("2026-10-30");
    expect(parseDate("2026-02-30")).toBeNull();
  });

  it("takes weight units from the label, never assuming KG", () => {
    expect(unitIn("G.W.(LBS)")).toEqual({ kind: "mass", unit: "LBS" });
    expect(unitIn("MEAS.(CBM)")).toEqual({ kind: "volume", unit: "CBM" });
    expect(unitIn("DESCRIPTION")).toBeNull();
    expect(toBase("100", "LBS")).toBe("45.359237");
    expect(toBase("1", "STONE")).toBeNull();
  });

  it("splits a party into name and address", () => {
    expect(splitParty("ACME CORP.\n1 MAIN ST\nTAIPEI")).toEqual({ name: "ACME CORP.", address: "1 MAIN ST\nTAIPEI" });
  });

  it("looks up ports by printed name", () => {
    expect(lookupPort("KEELUNG, TAIWAN")).toBe("TWKEL");
    expect(lookupPort("高雄")).toBe("TWKHH");
    expect(lookupPort("USLGB")).toBe("USLGB");
    expect(lookupPort("ATLANTIS")).toBeNull();
  });
});
