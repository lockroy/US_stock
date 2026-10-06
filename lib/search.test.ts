import assert from "node:assert/strict";
import { test } from "node:test";
import { createSearchController, type SearchState } from "./search";
import { tierColor } from "./scoring/presentation";
import { tierOf } from "./scoring/scoring";
import type { DataResponse, SearchResult } from "./types";

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function result(symbol: string): DataResponse<SearchResult[]> {
  return { mode: "real", source: "nasdaq", query: symbol, data: [{ symbol, name: symbol, type: "STOCK" }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("only the last query in a debounce burst is requested", async () => {
  const queries: string[] = [];
  const states: SearchState[] = [];
  const search = createSearchController(async q => { queries.push(q); return result(q); }, state => states.push(state), 0);
  try {
    search.search("A"); search.search("AA"); search.search("AAPL");
    await tick();
    assert.deepEqual(queries, ["AAPL"]);
    assert.equal(states.at(-1)?.items[0].symbol, "AAPL");
    assert.equal(states.at(-1)?.loading, false);
  } finally { search.cancel(); }
});

test("late results from an aborted request cannot overwrite new results even when abort is ignored", async () => {
  const old = deferred<DataResponse<SearchResult[]>>();
  const recent = deferred<DataResponse<SearchResult[]>>();
  const signals: AbortSignal[] = [];
  const states: SearchState[] = [];
  const search = createSearchController((q, signal) => { signals.push(signal); return q === "AAPL" ? old.promise : recent.promise; }, state => states.push(state), 0);
  try {
    search.search("AAPL"); await tick();
    search.search("TSLA"); await tick();
    assert.equal(signals[0].aborted, true);
    recent.resolve(result("TSLA")); await tick();
    old.resolve(result("AAPL")); await tick();
    assert.equal(states.at(-1)?.items[0].symbol, "TSLA");
    assert.equal(states.at(-1)?.loading, false);
  } finally { search.cancel(); }
});

test("clearing the query suppresses old results and resets loading", async () => {
  const pending = deferred<DataResponse<SearchResult[]>>();
  const states: SearchState[] = [];
  const search = createSearchController(() => pending.promise, s => states.push(s), 0);
  try {
    search.search("AAPL"); await tick();
    search.search(" "); pending.resolve(result("AAPL")); await tick();
    assert.deepEqual(states.at(-1), { items: [], loading: false, error: null });
  } finally { search.cancel(); }
});

test("cancelling pending work on dismissal/unmount prevents state updates", async () => {
  const pending = deferred<DataResponse<SearchResult[]>>();
  const states: SearchState[] = [];
  const search = createSearchController(() => pending.promise, s => states.push(s), 0);
  search.search("AAPL"); await tick();
  search.cancel(); const count = states.length;
  pending.resolve(result("AAPL")); await tick();
  assert.equal(states.length, count);
});

test("old errors do not erase newer results; current errors stop loading and remain visible", async () => {
  const old = deferred<DataResponse<SearchResult[]>>();
  const states: SearchState[] = [];
  const search = createSearchController(q => q === "OLD" ? old.promise : q === "NEW" ? Promise.resolve(result(q)) : Promise.reject(new Error("行情服務不可用")), s => states.push(s), 0);
  try {
    search.search("OLD"); await tick(); search.search("NEW"); await tick();
    old.reject(new Error("old failure")); await tick();
    assert.equal(states.at(-1)?.items[0].symbol, "NEW");
    search.search("FAIL"); await tick();
    assert.equal(states.at(-1)?.error, "行情服務不可用");
    assert.equal(states.at(-1)?.loading, false);
  } finally { search.cancel(); }
});

test("all actual tier strings map to their intended colors", () => {
  for (const [score, expected] of [[80, "#22c55e"], [65, "#22c55e"], [50, "#f59e0b"], [49, "#ef4444"]] as const) {
    assert.equal(tierColor(tierOf(score)), expected);
  }
  assert.equal(tierColor("資料不足 / 暫不評級"), "#8b949e");
});
