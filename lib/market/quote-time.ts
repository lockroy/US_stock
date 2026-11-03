import { nyClock } from "./calendar";

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const validDay = (day: string) => {
  const ms = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
};

// Only explicit Nasdaq ET wall times are converted; date-only labels have no epoch.
// On the autumn DST overlap two instants match; on the spring gap none match.
// Both stay unknown instead of guessing an offset. Source precision is one minute.
export function parseQuoteTime(value: unknown): { day: string; timestamp: number | null } | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validDay(text) ? { day: text, timestamp: null } : null;
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s+(AM|PM)\s+ET)?$/.exec(text);
  if (!match) return null;
  const day = `${match[3]}-${String(months.indexOf(match[1]) + 1).padStart(2, "0")}-${match[2].padStart(2, "0")}`;
  if (!validDay(day)) return null;
  if (match[4] === undefined) return { day, timestamp: null };
  const hour12 = Number(match[4]), minute = Number(match[5]);
  if (hour12 < 1 || hour12 > 12 || minute > 59) return null;
  const wallMinute = (hour12 % 12 + (match[6] === "PM" ? 12 : 0)) * 60 + minute;
  const wall = Date.parse(`${day}T00:00:00Z`) + wallMinute * 60000;
  const candidates = [4, 5].map(offset => wall + offset * 3600000).filter(ms => {
    const local = nyClock(new Date(ms));
    return local.day === day && local.minute === wallMinute;
  });
  return candidates.length === 1 ? { day, timestamp: candidates[0] / 1000 } : null;
}
