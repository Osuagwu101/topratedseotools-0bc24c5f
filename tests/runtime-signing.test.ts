import { createHmac } from "node:crypto";
import { signRuntimeRequest } from "../src/lib/self-hosted-runtime.server.ts";

let passed = 0;
function assert(value: unknown, message: string) { if (!value) throw new Error(message); passed++; }

const input = { method: "POST", path: "/api/sessions", writerId: "writer-123",
  body: JSON.stringify({ writer_id: "writer-123", tool_slug: "chatgpt" }),
  timestamp: 1789174800, nonce: "abcdefghijklmnop", secret: "s".repeat(32) };
const signature = signRuntimeRequest(input);
assert(/^[a-f0-9]{64}$/.test(signature), "signature is a SHA-256 hex digest");
assert(signature === signRuntimeRequest(input), "same canonical request has the same signature");
assert(signature !== signRuntimeRequest({ ...input, body: JSON.stringify({ writer_id: "writer-123", tool_slug: "phrasly" }) }),
  "changing the tool invalidates the signature");
assert(signature !== createHmac("sha256", input.secret).update("wrong").digest("hex"),
  "signature is bound to the runtime canonical request");
console.log(`runtime-signing: ${passed} passed`);
