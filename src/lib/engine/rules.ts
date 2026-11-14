/** Versioned rule packs → typed parameters. Nothing here reads the clock or network. */
import Decimal from "decimal.js";
import type { TaxYear } from "@/domain/contracts";
import pack2026 from "../../../data/rules/us-federal-2026.json";
import pack2027 from "../../../data/rules/us-federal-2027.json";
import sourcesFile from "../../../data/rules/sources.json";
import table2026 from "../../../data/reference/2026-8962-table2.json";
import { dollars, rate, type Rate } from "./money";

export const ENGINE_VERSION = "headroom-engine-1.1.1";
export const RULES_VERSION = "us-federal-aca-2026-2027.r3";

export type Filing = "single" | "mfj";

export interface Band { fromPct: number; toPct: number; start: string; end: string }
type RawPack = typeof pack2026 | typeof pack2027;

export interface RulePack {
  year: TaxYear;
  packVersion: string;
  /** HHS guideline year used for this coverage year (prior calendar year). */
  coverageFplGuidelineYear: number;
  fplDollars(familySize: number): number;
  fplSourceId: string;
  /** Applicable figure × 10000 for a Form 8962 line 5 value in 0..400. */
  applicableFigure(line5: number): number;
  applicableFigureMethod: string;
  applicableFigureStatus: string;
  applicableFigureSourceIds: string[];
  standardDeduction: Record<Filing, number>;
  brackets: Record<Filing, Array<{ top: number; rate: Rate }>>;
  bracketSourceId: string;
  taxTableUpper: number;
  supportedTaxableBeforeQbi: Record<Filing, number>;
  se: { factor: Rate; ss: Rate; medicare: Rate; minimumNet: number; wageBase: number; sourceIds: string[] };
  fica: { ss: Rate; medicare: Rate; sourceId: string };
  addlMedicare: { rate: Rate; threshold: Record<Filing, number>; sourceId: string };
  niit: { rate: Rate; threshold: Record<Filing, number>; sourceId: string };
  qbi: { rate: Rate; minimumDeduction: number; minimumQbi: number; sourceId: string };
  ctc: { perChild: number; refundablePerChild: number | null; earnedFloor: number; refundableRate: Rate;
    otherDependent: number; phaseoutThreshold: Record<Filing, number>; phaseoutPerThousand: number; sourceIds: string[] };
  eitcBound: Record<Filing, number[]>;
  eitcSourceId: string;
  sep: { rate: Rate; cap: number; sourceIds: string[] };
  returnDueDate: string;
}

/**
 * Table 2 method: linear interpolation inside the Rev. Proc. band for the whole
 * line-5 percentage, then rounded half-up to four decimals in exact decimal
 * arithmetic (175% in 2026 → 0.0540, not the binary-float 0.0539).
 */
export function interpolateFigure(bands: Band[], line5: number): number {
  const band = bands.find(b => line5 >= b.fromPct && line5 < b.toPct) ?? (line5 === 400 ? bands[bands.length - 1] : undefined);
  if (!band) throw new RangeError(`No applicable band for ${line5}`);
  const start = new Decimal(band.start), end = new Decimal(band.end);
  const pct = start.plus(end.minus(start).times(line5 - band.fromPct).dividedBy(band.toPct - band.fromPct));
  return pct.dividedBy(100).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).times(10000).toNumber();
}

function build(raw: RawPack): RulePack {
  const bands = raw.applicableFigure.bands as Band[];
  const official = raw.applicableFigure.method === "official-table" ? table2026.figures as Record<string, number> : null;
  const figures: number[] = [];
  for (let k = 0; k <= 400; k++) figures.push((official && k >= 100 ? official[String(k)] : undefined) ?? interpolateFigure(bands, k));
  for (let k = 1; k <= 400; k++) if (figures[k] < figures[k - 1]) throw new Error("Applicable figure table must be non-decreasing");
  const money = (rec: { single: number; mfj: number }) => ({ single: dollars(rec.single), mfj: dollars(rec.mfj) });
  const br = (rows: (string | number)[][]) => rows.map(([top, r]) => ({ top: dollars(top as number), rate: rate(r as string) }));
  const ctc = raw.childTaxCredit;
  return {
    year: raw.taxYear as TaxYear,
    packVersion: raw.packVersion,
    coverageFplGuidelineYear: raw.coverageFplGuidelineYear,
    fplDollars: (n: number) => raw.fpl.baseDollars + raw.fpl.stepDollars * (n - 1),
    fplSourceId: raw.fpl.sourceId,
    applicableFigure: (line5: number) => {
      if (!Number.isInteger(line5) || line5 < 0 || line5 > 400) throw new RangeError("line 5 outside table");
      return figures[line5];
    },
    applicableFigureMethod: raw.applicableFigure.method,
    applicableFigureStatus: raw.applicableFigure.tableStatus,
    applicableFigureSourceIds: raw.applicableFigure.sourceIds,
    standardDeduction: money(raw.standardDeductionDollars),
    brackets: { single: br(raw.brackets.single), mfj: br(raw.brackets.mfj) },
    bracketSourceId: raw.brackets.sourceId,
    taxTableUpper: dollars(raw.taxTableUpperDollars),
    supportedTaxableBeforeQbi: money(raw.supportedTaxableIncomeBeforeQbiDollars),
    se: { factor: rate(raw.selfEmployment.netEarningsFactor), ss: rate(raw.selfEmployment.socialSecurityRate),
      medicare: rate(raw.selfEmployment.medicareRate), minimumNet: dollars(raw.selfEmployment.minimumNetEarningsDollars),
      wageBase: dollars(raw.selfEmployment.socialSecurityWageBaseDollars), sourceIds: raw.selfEmployment.sourceIds },
    fica: { ss: rate(raw.employeeFica.socialSecurityRate), medicare: rate(raw.employeeFica.medicareRate), sourceId: raw.employeeFica.sourceId },
    addlMedicare: { rate: rate(raw.additionalMedicare.rate), threshold: money(raw.additionalMedicare.thresholdDollars), sourceId: raw.additionalMedicare.sourceId },
    niit: { rate: rate(raw.niit.rate), threshold: money(raw.niit.thresholdDollars), sourceId: raw.niit.sourceId },
    qbi: { rate: rate(raw.qbi.rate), minimumDeduction: dollars(raw.qbi.minimumDeductionDollars), minimumQbi: dollars(raw.qbi.minimumQbiDollars), sourceId: raw.qbi.sourceId },
    ctc: { perChild: dollars(ctc.perChildDollars), refundablePerChild: ctc.refundablePerChildDollars === null ? null : dollars(ctc.refundablePerChildDollars),
      earnedFloor: dollars(ctc.refundableEarnedIncomeFloorDollars), refundableRate: rate(ctc.refundableRate),
      otherDependent: dollars(ctc.otherDependentDollars), phaseoutThreshold: money(ctc.phaseoutThresholdDollars),
      phaseoutPerThousand: dollars(ctc.phaseoutPerThousandDollars), sourceIds: ctc.sourceIds },
    eitcBound: { single: raw.eitcSupportBoundDollars.single.map(dollars), mfj: raw.eitcSupportBoundDollars.mfj.map(dollars) },
    eitcSourceId: raw.eitcSupportBoundDollars.sourceId,
    sep: { rate: rate(raw.sep.netEarningsRate), cap: dollars(raw.sep.annualCapDollars), sourceIds: raw.sep.sourceIds },
    returnDueDate: raw.returnDueDate,
  };
}

const PACKS: Record<TaxYear, RulePack> = { 2026: build(pack2026), 2027: build(pack2027) };
export const rulesFor = (year: TaxYear): RulePack => PACKS[year];
export const SOURCES = sourcesFile.sources;
export const SOURCE_IDS = new Set(SOURCES.map(s => s.id));
/** Transcribed 2026 DRAFT Table 2, exported for verification. */
export const TABLE_2026 = table2026;
export const RULE_BANDS: Record<TaxYear, Band[]> = {
  2026: pack2026.applicableFigure.bands as Band[], 2027: pack2027.applicableFigure.bands as Band[],
};
