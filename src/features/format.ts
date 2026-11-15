/**
 * Display helpers only. These never perform financial arithmetic; they format
 * integer-cent values returned by the engine or typed by the user.
 */
const whole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0, minimumFractionDigits: 0 });
const exact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A date-only user input follows the browser's calendar day, not the UTC day. */
export function localCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/** "$12,000" — rounded for display only. */
export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return whole.format(cents / 100);
}

/** "$12,000.50" — keeps cents (used in source trails). */
export function moneyExact(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  return exact.format(cents / 100);
}

/** "+$5,361" / "−$3,435" / "$0". */
export function signedMoney(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "—";
  const rounded = Math.round(cents / 100);
  if (rounded === 0) return "$0";
  return `${rounded > 0 ? "+" : "−"}${whole.format(Math.abs(cents) / 100)}`;
}

export function signClass(cents: number | null | undefined): "pos" | "neg" | "zero" {
  if (!cents || Math.round(cents / 100) === 0) return "zero";
  return cents > 0 ? "pos" : "neg";
}

/** Converts a user-typed dollar string to integer cents without floating point. */
export function parseDollarsToCents(raw: string): number | null | "invalid" {
  const text = raw.replace(/[$,\s]/g, "");
  if (text === "") return null;
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(text);
  if (!match) return "invalid";
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? "").padEnd(2, "0"));
  const value = dollars * 100 + cents;
  return Number.isSafeInteger(value) ? value : "invalid";
}

/** Cents → editable dollar string ("12000" or "12000.5"). */
export function centsToInput(cents: number | null): string {
  if (cents === null) return "";
  const dollars = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return rest === 0 ? String(dollars) : `${dollars}.${String(rest).padStart(2, "0")}`;
}

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

/** Formats an ISO date (YYYY-MM-DD) without timezone drift. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "No fixed date";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}

export function shortFingerprint(fp: string): string {
  return fp.length > 12 ? `${fp.slice(0, 12)}…` : fp;
}

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Rewrites ISO dates inside engine text ("2026-12-20") as "Dec 20, 2026" — wording only, no new facts. */
export function humanizeDates(text: string): string {
  return text.replace(/\b(20\d{2})-(\d{2})-(\d{2})\b/g, iso => shortDate(iso));
}
