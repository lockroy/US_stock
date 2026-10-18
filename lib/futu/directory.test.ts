import assert from "node:assert/strict";
import { test } from "node:test";
import { createDirectorySearch, parseDirectory, matchDirectory, eligibleSecurity } from "./directory";
import { searchSymbols, ReportError } from "./client";

const rows = [
  { symbol: "AAPL", name: "Apple Inc. Common Stock" },
  { symbol: "APLE", name: "Apple Hospitality REIT Common Shares" },
  { symbol: "MSFT", name: "Microsoft Corporation Common Stock" },
  { symbol: "TSM", name: "Taiwan Semiconductor Manufacturing Company Ltd." },
  { symbol: "BRK/B", name: "Berkshire Hathaway Inc." },
  { symbol: "AAPLW", name: "Apple Warrants" },
];
const payload = (r = rows) => ({ data: { totalrecords: r.length, table: { rows: r } } });

test("directory normalizes share classes, preserves ADRs and ordinary names and excludes other securities", () => {
  const result = parseDirectory(payload(), "nyse");
  assert.equal(result.length, 5);
  assert.ok(result.some(x => x.symbol === "US.TSM"));
  assert.ok(result.some(x => x.symbol === "US.BRK.B"));
  assert.equal(result[0].exchange, "NYSE");
  for (const name of ["Example ETF", "Example Fund Common Stock", "Example Preferred Shares", "Example Warrants", "Example Units", "Example Notes", "Example Rights"]) assert.equal(eligibleSecurity(name), false);
  assert.equal(eligibleSecurity("UnitedHealth Group Incorporated Common Stock"), true);
});

test("search ranks exact symbols first, handles names, prefixes, punctuation and no matches", () => {
  const data = parseDirectory(payload(), "nasdaq");
  assert.equal(matchDirectory(data, " us.aapl ")[0].symbol, "US.AAPL");
  assert.equal(matchDirectory(data, "Apple").length, 2);
  assert.equal(matchDirectory(data, "Microsoft Corporation")[0].symbol, "US.MSFT");
  assert.equal(matchDirectory(data, "BRK/B")[0].symbol, "US.BRK.B");
  assert.deepEqual(matchDirectory(data, "nonexistent corporation"), []);
});

test("truncated or malformed directories cannot masquerade as complete search results", () => {
  for (const input of [null, {}, { data: { totalrecords: 50, table: { rows } } }, payload([]), payload([{ symbol: "AAPL", name: "" }])]) {
    assert.throws(() => parseDirectory(input, "nasdaq"));
  }
});

test("three exchanges load once on demand, deduplicate across exchanges, share in-flight work and refresh on expiry", async () => {
  let calls = 0;
  let clock = 0;
  const exchanges = new Set<string>();
  const search = createDirectorySearch(async input => {
    calls++;
    const url = new URL(String(input));
    exchanges.add(url.searchParams.get("exchange")!);
    assert.equal(url.searchParams.get("limit"), "10000");
    return Response.json(payload());
  }, () => clock);
  assert.equal(calls, 0);
  const [apple, msft] = await Promise.all([search("Apple"), search("MSFT")]);
  assert.equal(apple.length, 2);
  assert.equal(msft.length, 1);
  assert.equal(calls, 3);
  assert.deepEqual([...exchanges].sort(), ["amex", "nasdaq", "nyse"]);
  await search("TSM"); assert.equal(calls, 3);
  clock = 3600001;
  await search("TSM"); assert.equal(calls, 6);
});

test("partial exchange failures produce an error and retry instead of zero matches", async () => {
  let failed = true;
  const search = createDirectorySearch(async input => {
    if (failed && String(input).includes("exchange=nyse")) return new Response("denied", { status: 403 });
    return Response.json(payload());
  });
  await assert.rejects(search("Apple"));
  failed = false;
  assert.equal((await search("Apple")).length, 2);
});

test("real name search uses directory only; malformed queries never contact a provider", async () => {
  let calls = 0;
  const directorySearch = async (q: string) => { calls++; return matchDirectory(parseDirectory(payload(), "nasdaq"), q); };
  assert.equal((await searchSymbols("Microsoft", { realData: true, directorySearch }))[0].symbol, "US.MSFT");
  for (const query of ["BAD_SYMBOL", "x?token=1", "a".repeat(101)]) {
    await assert.rejects(searchSymbols(query, { realData: true, directorySearch }), (e: unknown) => e instanceof ReportError && e.status === 400);
  }
  assert.equal(calls, 1);
});
