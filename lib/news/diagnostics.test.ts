import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectGoogleFailure } from "./diagnostics";
import { fetchGoogleNews } from "./google";

test("Google error diagnostics classify notices without retaining response bodies or cookies", async () => {
  for (const [body, hint] of [["Our systems have detected unusual traffic", "automated_request_notice"], ["Before you continue to Google", "consent_notice"], ["Service unavailable", "server_unavailable_notice"], ["No details", "unclassified"]]) {
    const result = await inspectGoogleFailure(new Response(body + " private marker", { status: 503, headers: { "content-type": "text/html", "set-cookie": "secret", "retry-after": "60" } }));
    assert.equal(result.hint, hint);
    assert.equal(result.upstreamStatus, 503);
    assert.equal(result.retryAfterSeconds, 60);
    assert.ok(!JSON.stringify(result).includes("private marker"));
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
});

test("diagnostic body inspection stops after 8 KiB and cancels the remaining stream", async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(8192) + "unusual traffic")); }, cancel() { cancelled = true; } }), { status: 503 });
  assert.equal((await inspectGoogleFailure(response)).hint, "unclassified");
  assert.equal(cancelled, true);
});

test("public diagnostic ID matches a structured log without exposing raw upstream errors", async () => {
  const original = console.warn;
  const logs: unknown[][] = [];
  console.warn = (...args: unknown[]) => { logs.push(args); };
  try {
    const result = await fetchGoogleNews("AAPL", { fetcher: async () => new Response("automated queries private", { status: 503 }) });
    assert.ok(result.diagnosticId);
    const detail = JSON.parse(String(logs[0][1]));
    assert.equal(detail.diagnosticId, result.diagnosticId);
    assert.equal(detail.phase, "http_response");
    assert.equal(detail.upstreamStatus, 503);
    assert.equal(detail.hint, "automated_request_notice");
    assert.equal(result.diagnostic?.hint, "automated_request_notice");
    assert.equal(result.diagnostic?.upstreamStatus, 503);
    assert.ok(!JSON.stringify(result).includes("private"));
    assert.ok(!JSON.stringify(logs).includes("private"));
    logs.length = 0;
    await fetchGoogleNews("AAPL", { fetcher: async () => { throw new TypeError("private URL or credential"); } });
    assert.equal(JSON.parse(String(logs[0][1])).phase, "fetch");
    assert.ok(!JSON.stringify(logs).includes("private URL"));
    logs.length = 0;
    const invalid = await fetchGoogleNews("AAPL", { fetcher: async () => new Response("<html>Not RSS</html>", { headers: { "content-type": "text/html" } }) });
    assert.equal(invalid.diagnostic?.phase, "parse_rss");
    assert.equal(invalid.diagnostic?.upstreamStatus, 200);
    assert.equal(invalid.diagnostic?.contentType, "text/html");
  } finally { console.warn = original; }
});
