/**
 * Exact money arithmetic for the engine.
 *
 * All amounts are integer USD cents. Rates are exact decimal fractions
 * (`num / den`, den a power of ten) parsed from the rule packs' decimal strings
 * with decimal.js. Every product is computed exactly in integers and rounded
 * only where a form line rounds, using an explicit mode. No binary
 * floating-point rate multiplication happens anywhere in the financial path.
 */
import Decimal from "decimal.js";

export type Rounding = "half_up" | "down" | "floor" | "ceil";

export interface Rate { readonly num: number; readonly den: number; readonly text: string }

export function rate(text: string): Rate {
  const d = new Decimal(text);
  if (d.isNegative() || d.decimalPlaces() > 6) throw new Error(`Unsupported rate ${text}`);
  const den = 10 ** d.decimalPlaces();
  const num = d.times(den).toNumber();
  if (!Number.isSafeInteger(num)) throw new Error(`Unsafe rate ${text}`);
  return { num, den, text };
}

function safe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError("Amount outside exact integer range");
  return n;
}

/** Integer division of a by b (b > 0) with explicit rounding; half_up rounds ties away from zero. */
export function divRound(a: number, b: number, mode: Rounding): number {
  safe(a); safe(b);
  if (b <= 0) throw new RangeError("Divisor must be positive");
  const q = Math.trunc(a / b);
  const r = a - q * b; // exact: |r| < b
  if (r === 0) return q;
  switch (mode) {
    case "down": return q;
    case "floor": return r < 0 ? q - 1 : q;
    case "ceil": return r > 0 ? q + 1 : q;
    case "half_up": return Math.abs(r) * 2 >= b ? (a < 0 ? q - 1 : q + 1) : q;
  }
}

/** cents × rate, rounded to whole cents. */
export function mulRate(cents: number, r: Rate, mode: Rounding = "half_up"): number {
  return divRound(safe(cents * r.num), r.den, mode);
}

/** cents × (num / den), rounded to whole cents. */
export function mulRatio(cents: number, num: number, den: number, mode: Rounding = "half_up"): number {
  return divRound(safe(cents * num), den, mode);
}

/** Round cents to a whole-dollar amount (still expressed in cents). */
export function toWholeDollars(cents: number, mode: Rounding = "half_up"): number {
  return divRound(cents, 100, mode) * 100;
}

/** Whole-dollar rule-pack parameter → cents. */
export const dollars = (d: number): number => {
  if (!Number.isInteger(d)) throw new Error("Rule-pack dollar parameters must be whole dollars");
  return safe(d * 100);
};
export const sum = (xs: number[]): number => xs.reduce((a, b) => safe(a + b), 0);

export function formatUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = abs % 100;
  return `${sign}$${whole}${frac ? "." + frac.toString().padStart(2, "0") : ""}`;
}
