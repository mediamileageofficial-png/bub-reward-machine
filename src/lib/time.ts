/** Time helpers. Internally everything is UTC ISO strings; only day buckets use the event timezone. */

let clockOverride: (() => Date) | null = null;

/** Test hook: freeze or shift the clock. Pass null to restore. */
export function setClock(fn: (() => Date) | null) {
  clockOverride = fn;
}

export function now(): Date {
  return clockOverride ? clockOverride() : new Date();
}

export function nowIso(): string {
  return now().toISOString();
}

/** YYYY-MM-DD for the given instant in the given IANA timezone (used for daily reward limits). */
export function dayKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

/** Converts an event-local date (YYYY-MM-DD) + time to a UTC ISO string, given the event's fixed UTC offset (config). */
export function localDateToUtcIso(localDate: string, time: "start" | "end", utcOffsetMinutes: number): string {
  const [y, m, d] = localDate.split("-").map(Number);
  const ms = time === "start" ? Date.UTC(y, m - 1, d, 0, 0, 0, 0) : Date.UTC(y, m - 1, d, 23, 59, 59, 999);
  return new Date(ms - utcOffsetMinutes * 60_000).toISOString();
}

export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
