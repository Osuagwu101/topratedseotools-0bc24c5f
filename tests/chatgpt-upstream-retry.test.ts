/** Run: bun tests/chatgpt-upstream-retry.test.ts */
import assert from "node:assert/strict";
import { fetchWithNetworkRetry, isSafeToRetry } from "../src/lib/chatgpt-upstream-retry";

const err = (code: string) => Object.assign(new TypeError("fetch failed"), { cause: { code } });
const noSleep = async () => {};
const ok = new Response("ok");

// GET: a blip followed by success returns the response.
{
  let calls = 0;
  const r = await fetchWithNetworkRetry(async () => { if (++calls < 2) throw err("ECONNRESET"); return ok; }, "GET", [1, 1], noSleep);
  assert.equal(r, ok); assert.equal(calls, 2);
}
// GET: gives up after the retries.
{
  let calls = 0;
  await assert.rejects(fetchWithNetworkRetry(async () => { calls++; throw err("ECONNRESET"); }, "GET", [1, 1], noSleep));
  assert.equal(calls, 3);
}
// POST: a mid-flight reset is NOT resent (ChatGPT may have received the message).
{
  let calls = 0;
  await assert.rejects(fetchWithNetworkRetry(async () => { calls++; throw err("ECONNRESET"); }, "POST", [1, 1], noSleep));
  assert.equal(calls, 1);
}
// POST: never connected (DNS / refused / connect timeout) is resent safely.
{
  let calls = 0;
  const r = await fetchWithNetworkRetry(async () => { if (++calls < 2) throw err("UND_ERR_CONNECT_TIMEOUT"); return ok; }, "POST", [1, 1], noSleep);
  assert.equal(r, ok); assert.equal(calls, 2);
}
assert.equal(isSafeToRetry("post", err("ENOTFOUND")), true);
assert.equal(isSafeToRetry("POST", new Error("other")), false);
console.log("chatgpt-upstream-retry tests passed");
