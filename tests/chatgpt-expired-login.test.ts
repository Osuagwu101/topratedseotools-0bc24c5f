/** Run: bun tests/chatgpt-expired-login.test.ts */
import assert from "node:assert/strict";
import { chatGptSessionIsExpired } from "../src/lib/chatgpt-account-auth.server";

const jwt = (exp: number) => "h." + Buffer.from(JSON.stringify({ exp })).toString("base64url") + ".s";
const now = Date.UTC(2026, 10, 27);
const future = Math.floor(now / 1000) + 86400;
const past = Math.floor(now / 1000) - 86400;

assert.equal(chatGptSessionIsExpired({ accessToken: jwt(future) }, now), false);
assert.equal(chatGptSessionIsExpired({ accessToken: jwt(past) }, now), true);
assert.equal(chatGptSessionIsExpired({ accessToken: jwt(future), error: "RefreshAccessTokenError" }, now), true);
assert.equal(chatGptSessionIsExpired({}, now), true);
assert.equal(chatGptSessionIsExpired({ accessToken: "opaque-token" }, now), false);
console.log("chatgpt-expired-login: ok");
