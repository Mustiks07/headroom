import { expect } from "vitest";

/** Minimal RFC 5545 structure check (unfolding, 75-octet lines, BEGIN/END balance, required properties). */
export function parseIcs(text: string): Array<Record<string, string>> {
  expect(text.endsWith("\r\n")).toBe(true);
  const raw = text.split("\r\n").slice(0, -1);
  for (const l of raw) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  const lines = raw.reduce<string[]>((acc, l) => { if (l.startsWith(" ")) acc[acc.length - 1] += l.slice(1); else acc.push(l); return acc; }, []);
  const stack: string[] = []; const events: Array<Record<string, string>> = []; let cur: Record<string, string> | null = null;
  for (const l of lines) {
    const [nameParams, ...rest] = l.split(":"); const value = rest.join(":"); const name = nameParams.split(";")[0];
    if (name === "BEGIN") { stack.push(value); if (value === "VEVENT") cur = {}; continue; }
    if (name === "END") { expect(stack.pop()).toBe(value); if (value === "VEVENT") { events.push(cur!); cur = null; } continue; }
    if (cur && stack.at(-1) === "VEVENT") cur[name] = value;
  }
  expect(stack).toEqual([]);
  for (const e of events) for (const k of ["UID", "DTSTAMP", "DTSTART", "DTEND", "SUMMARY", "SEQUENCE", "STATUS"]) expect(e[k], k).toBeDefined();
  return events;
}
