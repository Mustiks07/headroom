// Group 1: official FPL / applicable-figure boundaries.
import { describe, expect, it } from "vitest";
import { interpolateFigure, RULE_BANDS, rulesFor, TABLE_2026 } from "@/lib/engine/rules";
import { line5Of, ptcFor } from "@/lib/engine/year";
import { family, model } from "./helpers";

describe("applicable figure and line 5", () => {
  it("reproduces all 301 entries of the transcribed 2026 DRAFT Table 2 with the band method used for 2027", () => {
    const figures = TABLE_2026.figures as Record<string, number>;
    expect(Object.keys(figures)).toHaveLength(301);
    const mismatches = Object.entries(figures).filter(([k, v]) => interpolateFigure(RULE_BANDS[2026], Number(k)) !== v);
    expect(mismatches).toEqual([]);
    expect(rulesFor(2026).applicableFigure(175)).toBe(540); // 0.0540, not the float-rounded 0.0539
  });

  it("uses the documented 2026 and 2027 band edges", () => {
    const r26 = rulesFor(2026), r27 = rulesFor(2027);
    expect([r26.applicableFigure(132), r26.applicableFigure(133), r26.applicableFigure(300), r26.applicableFigure(400)]).toEqual([210, 314, 996, 996]);
    expect([r27.applicableFigure(132), r27.applicableFigure(133), r27.applicableFigure(400)]).toEqual([215, 323, 1022]);
    expect([r26.fplDollars(1), r26.fplDollars(3), r27.fplDollars(1), r27.fplDollars(3)]).toEqual([15650, 26650, 15960, 27320]);
  });

  it("truncates line 5 and treats exactly 400% differently from above 400%", () => {
    const fpl = 26650;
    expect(line5Of(400 * fpl, fpl)).toBe(400);          // exactly $106,600.00
    expect(line5Of(400 * fpl + 1, fpl)).toBe(401);      // one cent above
    expect(line5Of(133 * fpl - 1, fpl)).toBe(132);      // 132.99…% truncates
    expect(line5Of(100 * fpl, fpl)).toBe(100);
    const m = model(family());
    const atLine = ptcFor(m, 400 * fpl);
    expect(atLine.ptc).toBeGreaterThan(0);              // credit continues at exactly 400%
    expect(atLine.contribution8a).toBe(1061700);        // 106,600 × 0.0996 = 10,617.36 → $10,617
    // Form 8962 takes whole dollars: $106,600.49 is entered as $106,600 (credit), $106,600.50 as $106,601 (none).
    expect(ptcFor(m, 400 * fpl + 49).ptc).toBeGreaterThan(0);
    expect(ptcFor(m, 400 * fpl + 50).ptc).toBe(0);
  });
});
