import assert from "node:assert/strict";
import { test } from "node:test";
import { marketSession, lastCompletedSession, calendarSnapshot } from "./calendar";
import { closedDailyBar } from "../fable/fable";
import { checkQuoteDate } from "../fable/timeliness";
import type { Quote } from "../types";

const utcDay = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

test("bounded XNYS reference includes holidays, weekends and known special closure", () => {
  for (const date of ["2025-01-09", "2026-06-19", "2026-07-03", "2026-11-26", "2026-10-25", "2027-12-24"]) {
    assert.equal(marketSession(date).kind, "closed", date);
  }
  assert.equal(marketSession("2026-07-02").close, "16:00");
  assert.equal(marketSession("2027-12-31").close, "16:00"); // 不套用一般銀行假期規則
});

test("scheduled early closes and DST convert through New York without a fixed UTC offset", () => {
  assert.equal(marketSession("2026-11-27").close, "13:00");
  assert.equal(marketSession("2026-12-24").kind, "early_close");
  assert.equal(lastCompletedSession(new Date("2026-11-27T17:59:59Z")), "2026-11-25");
  assert.equal(lastCompletedSession(new Date("2026-11-27T18:00:00Z")), "2026-11-27");
  assert.equal(lastCompletedSession(new Date("2026-07-02T19:59:59Z")), "2026-07-01");
  assert.equal(lastCompletedSession(new Date("2026-07-02T20:00:00Z")), "2026-07-02");
});

test("latest expected close skips long weekends instead of using four calendar days", () => {
  assert.equal(lastCompletedSession(new Date("2026-07-05T15:00:00Z")), "2026-07-02");
  assert.equal(lastCompletedSession(new Date("2026-10-25T15:00:00Z")), "2026-10-23");
  assert.equal(lastCompletedSession(new Date("2026-12-26T15:00:00Z")), "2026-12-24");
});

test("holiday bars are not confirmed and early close bars wait for scheduled close", () => {
  assert.equal(closedDailyBar(utcDay("2026-07-03"), new Date("2026-07-06T21:00:00Z")), false);
  assert.equal(closedDailyBar(utcDay("2026-11-27"), new Date("2026-11-27T17:59:59Z")), false);
  assert.equal(closedDailyBar(utcDay("2026-11-27"), new Date("2026-11-27T18:00:00Z")), true);
});

test("unknown years and invalid dates remain unknown, with source limits exposed", () => {
  for (const date of ["2035-01-01", "2023-12-29", "2026-02-30", "invalid"]) assert.equal(marketSession(date).kind, "unknown");
  assert.equal(lastCompletedSession(new Date("2035-01-01T22:00:00Z")), null);
  const snapshot = calendarSnapshot(new Date("2026-10-25T15:00:00Z"));
  assert.equal(snapshot.version, "4.13.2");
  assert.match(snapshot.verification, /第三方規則參考/);
});

test("quote on a non-session cannot be silently treated as a current trading date", () => {
  const quote: Quote = { symbol: "AAPL", name: "fixture", lastPrice: 100, change: null, changePct: null, volume: null, timestamp: null, asOf: "Oct 24, 2026" };
  assert.equal(checkQuoteDate(quote, utcDay("2026-10-23"), new Date("2026-10-25T15:00:00Z")).pass, null);
  assert.equal(quote.asOf, "Oct 24, 2026");
});
