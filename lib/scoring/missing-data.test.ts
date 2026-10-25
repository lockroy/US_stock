import assert from "node:assert/strict";
import { test } from "node:test";
import type { IndicatorSnapshot } from "../types";
import { score, scoreFundamental, scoreValuation, type ScoreInput } from "./scoring";

const indicators: IndicatorSnapshot = {
  ema20: 120, ema50: 110, ema200: 100, rsi: 55, macd: 2, macdSignal: 1, macdHist: 1,
  k: 60, d: 50, bollUpper: 130, bollMid: 120, bollLower: 110, atr: 2,
  volumeWeightedPrice20: 115, lastClose: 125,
};
const complete: ScoreInput = {
  financials: { revenueGrowth: 15, epsGrowth: 15, grossMargin: 50, roe: 50, roic: 50, fcf: 1, debtToEquity: 0.5 },
  valuation: { pe: 10, peg: 1, pb: 1, ps: null, evSales: null, fcfYield: 8 },
  ratings: { ratingScore: 5, buy: 1, hold: 0, sell: 0 }, indicators,
  marketTrendUp: true, sectorStrong: true,
};

test("missing a fully scoring input removes its weight instead of penalizing quality", () => {
  const full = score(complete);
  const partial = score({ ...complete, financials: { ...complete.financials!, fcf: null } });
  assert.equal(full.total, 100);
  assert.equal(partial.total, 100);
  assert.equal(partial.earnedPoints, 95);
  assert.equal(partial.completeness.percent, 95);
  assert.equal(partial.dimensions.find(d => d.dimension === "基本面")?.score, 100);
  assert.equal(partial.tier, "已知項目評分（非完整總評）");
  assert.ok(partial.completeness.missing.some(s => s.includes("自由現金流")));
});

test("observed weak or zero inputs remain scored, unlike missing inputs", () => {
  const zero = score({ ...complete, financials: { ...complete.financials!, fcf: 0, debtToEquity: 2 } });
  const absent = score({ ...complete, financials: { ...complete.financials!, fcf: null, debtToEquity: null } });
  assert.equal(zero.completeness.percent, 100);
  assert.equal(zero.total, 90);
  assert.equal(absent.total, 100);
  assert.equal(absent.completeness.percent, 90);
});

test("individual fundamental caps prevent a strong input from filling a weak or missing sibling", () => {
  const partial = scoreFundamental({ ...complete.financials!, revenueGrowth: 100, epsGrowth: null, grossMargin: 100, roe: 0, roic: null });
  assert.equal(partial.factors[0].score, 5);
  assert.equal(partial.factors[0].availableMax, 5);
  assert.equal(partial.factors[1].score, 10 / 3);
  assert.equal(partial.factors[1].availableMax, 20 / 3);
  const weak = scoreFundamental({ ...complete.financials!, revenueGrowth: 100, epsGrowth: 0 });
  assert.equal(weak.factors[0].score, 5);
});

test("only technical data can yield a partial score but never an overall buy or sell tier", () => {
  const result = score({ ...complete, financials: null, valuation: null, ratings: null, marketTrendUp: null, sectorStrong: null });
  assert.equal(result.total, 100);
  assert.equal(result.earnedPoints, 30);
  assert.equal(result.completeness.percent, 30);
  assert.equal(result.dimensions.find(d => d.dimension === "基本面")?.score, null);
  assert.equal(result.tier, "已知項目評分（非完整總評）");
  assert.doesNotMatch(result.tier, /買入|賣出/);
});

test("no usable inputs return unknown, never a numerical zero or NaN", () => {
  const invalid = Object.fromEntries(Object.keys(indicators).map(key => [key, NaN])) as unknown as IndicatorSnapshot;
  invalid.volumeWeightedPrice20 = null;
  const result = score({ ...complete, financials: null, valuation: null, ratings: null, marketTrendUp: null, sectorStrong: null, indicators: invalid });
  assert.equal(result.total, null);
  assert.equal(result.completeness.percent, 0);
  assert.equal(result.tier, "未能評估");
  assert.ok(result.dimensions.every(d => d.score === null));
});

test("normalization uses original available weights rather than averaging dimensions equally", () => {
  const result = score({ ...complete, financials: null, valuation: { ...complete.valuation!, pe: 50, peg: null, pb: null }, ratings: null, marketTrendUp: null, sectorStrong: null });
  assert.equal(result.total, Math.round(31 / 38 * 100));
  assert.equal(result.completeness.availablePoints, 38);
  assert.equal(result.dimensions.find(d => d.dimension === "估值")?.score, 13);
});

test("unusable valuation inputs do not score as cheap, and absent PE does not assert a loss", () => {
  const result = scoreValuation({ pe: null, peg: null, pb: null, ps: -1, evSales: NaN, fcfYield: 0 });
  assert.equal(result.score, 0);
  assert.equal(result.factors[1].available, false);
  assert.ok(result.factors.every(f => !f.sub.includes("虧損")));
  assert.equal(scoreValuation({ ...complete.valuation!, pb: -1, peg: -1 }).score, 8);
});

test("removing one dimension leaves all other dimension scores and coverage unchanged", () => {
  const full = score(complete);
  const partial = score({ ...complete, financials: null, ratings: null });
  for (const name of ["技術", "估值"]) {
    assert.deepEqual(partial.dimensions.find(d => d.dimension === name), full.dimensions.find(d => d.dimension === name));
  }
});

test("missing ROE cannot silently remove a valuation bonus or change P/B scoring", () => {
  const valuation = { ...complete.valuation!, pb: 50 };
  const known = score({ ...complete, valuation });
  const absent = score({ ...complete, valuation, financials: { ...complete.financials!, roe: null } });
  assert.deepEqual(known.dimensions.find(d => d.dimension === "估值"), absent.dimensions.find(d => d.dimension === "估值"));
  assert.equal(absent.factors.find(f => f.sub === "P/B")?.score, 1);
});

test("inapplicable PEG is excluded from coverage and missing inputs, while unknown PEG remains missing", () => {
  const valuation = { ...complete.valuation!, peg: null, pegApplicability: "not_applicable" as const };
  const result = score({ ...complete, valuation });
  assert.equal(result.total, 100);
  assert.equal(result.completeness.percent, 100);
  assert.equal(result.completeness.excludedPoints, 6);
  assert.equal(result.completeness.applicablePoints, 94);
  assert.equal(result.completeness.availablePoints, 94);
  assert.deepEqual(result.completeness.missing, []);
  assert.deepEqual(result.dimensions.find(d => d.dimension === "估值")?.notApplicable, ["PEG"]);
  const unknown = score({ ...complete, valuation: { ...valuation, pegApplicability: "unknown" } });
  assert.equal(unknown.completeness.percent, 94);
  assert.ok(unknown.completeness.missing.some(s => s.includes("PEG")));
});
