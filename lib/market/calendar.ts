import data from "./xnys-sessions.json";

export const CALENDAR_SOURCE = { name: data.source, version: data.version, url: data.sourceUrl,
  start: data.coverageStart, end: data.coverageEnd, timezone: data.timezone, verification: "第三方規則參考，非即時交易所公告" };
const sessions: Record<string, string> = data.sessions;
const format = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function nyClock(date: Date) {
  const parts = format.formatToParts(date);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { day: `${part("year")}-${part("month")}-${part("day")}`, minute: Number(part("hour")) * 60 + Number(part("minute")) };
}

export function marketSession(day: string) {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day
    || day < data.coverageStart || day > data.coverageEnd) return { kind: "unknown" as const, close: null, closeMinute: null };
  const close = sessions[day];
  if (!close) return { kind: "closed" as const, close: null, closeMinute: null };
  const [hour, minute] = close.split(":").map(Number);
  return { kind: close === "16:00" ? "regular" as const : "early_close" as const, close, closeMinute: hour * 60 + minute };
}

export function lastCompletedSession(asOf: Date): string | null {
  const now = nyClock(asOf);
  for (let offset = 0; offset < 15; offset++) {
    const day = new Date(Date.parse(`${now.day}T00:00:00Z`) - offset * 86400000).toISOString().slice(0, 10);
    const session = marketSession(day);
    if (session.kind === "unknown") return null;
    if (session.closeMinute !== null && (offset > 0 || now.minute >= session.closeMinute)) return day;
  }
  return null;
}

export function calendarSnapshot(asOf: Date) {
  const now = nyClock(asOf), session = marketSession(now.day);
  return { ...CALENDAR_SOURCE, day: now.day, session: session.kind, close: session.close, expectedLastClosedDay: lastCompletedSession(asOf) };
}

export type CalendarSnapshot = ReturnType<typeof calendarSnapshot>;
