import test from "node:test";
import assert from "node:assert/strict";

const base = "https://quillbot.topratedseotools.com/__qbtest";
const paths = [
  "/paraphrasing-tool",
  "/ssrprops",
  "/__host/media.quillbot.com/api/auth/token",
  "/__trst/enter?ticket=invalid",
];

for (const path of paths) {
  test("unauthenticated QuillBot path is blocked: " + path, async () => {
    const response = await fetch(base + path, { redirect: "manual" });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("set-cookie"), null);
  });
}

test("QuillBot health endpoint stays online", async () => {
  const response = await fetch(base + "/__trst/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("ChatGPT root continues to use its own gateway", async () => {
  const response = await fetch("https://chatgpt.topratedseotools.com/", { redirect: "manual" });
  assert.equal(response.status, 401);
});
