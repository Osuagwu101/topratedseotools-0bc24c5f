import test from "node:test";
import assert from "node:assert/strict";
import {
  createCipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  CHATGPT_SESSION_FORMAT,
  Phase5SessionError,
  normalisePhase5Session,
  encryptPhase5State,
  decryptPhase5Envelope,
  buildPhase5CookieHeader,
  extractPhase5Rotations,
  applyPhase5Rotations,
  loadSingleAccountSession,
  proxyWithSingleChatGptSession,
} from "./session-adapter.mjs";

process.env.CHATGPT_SESSION_ENCRYPTION_KEY = "11".repeat(32);
process.env.SUPABASE_URL = "https://db.example";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";

const rawLegacy = JSON.stringify({
  authenticated_cookies: [
    { name: "__Secure-next-auth.session-token.0", value: "opaque-0", domain: ".chatgpt.com", path: "/" },
    { name: "__Secure-next-auth.session-token.1", value: "opaque-1", domain: ".chatgpt.com", path: "/" },
    { name: "__Host-next-auth.csrf-token", value: "csrf-opaque", domain: ".chatgpt.com", path: "/" },
    { name: "__Secure-next-auth.callback-url", value: "https://chatgpt.com/", domain: ".chatgpt.com", path: "/" },
    { name: "oai-did", value: "supporting-device", domain: ".chatgpt.com", path: "/" },
    { name: "_account", value: "supporting-account", domain: ".chatgpt.com", path: "/" },
    { name: "_puid", value: "supporting-puid", domain: ".chatgpt.com", path: "/" },
    { name: "_uasid", value: "supporting-uasid", domain: ".chatgpt.com", path: "/" },
    { name: "_umsid", value: "supporting-umsid", domain: ".chatgpt.com", path: "/" },
    { name: "oai-sc", value: "supporting-security", domain: ".chatgpt.com", path: "/" },
    { name: "_ga", value: "analytics", domain: ".chatgpt.com", path: "/" },
    { name: "cf_clearance", value: "challenge", domain: ".chatgpt.com", path: "/" },
  ],
  session_tokens: {
    storage: {
      localStorage: { legacy: "must-not-survive" },
      sessionStorage: { legacy: "must-not-survive" },
    },
  },
});

test("normalises legacy bundle to minimal cookie-only v3", () => {
  const parsed = JSON.parse(normalisePhase5Session(rawLegacy));
  assert.equal(parsed.version, 3);
  assert.deepEqual(parsed.cookies.map(c => c.name), [
    "__Secure-next-auth.session-token.0",
    "__Secure-next-auth.session-token.1",
    "__Host-next-auth.csrf-token",
    "__Secure-next-auth.callback-url",
    "_account",
    "_puid",
    "_uasid",
    "_umsid",
    "oai-did",
    "oai-sc",
  ]);
  assert.equal("session_tokens" in parsed, false);
  assert.equal(JSON.stringify(parsed).includes("must-not-survive"), false);
});

test("preserves opaque values exactly", () => {
  const parsed = JSON.parse(normalisePhase5Session(rawLegacy));
  assert.equal(parsed.cookies[0].value, "opaque-0");
  assert.equal(parsed.cookies[1].value, "opaque-1");
});

test("rejects duplicate names and wrong auth-cookie scope", () => {
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"__Secure-next-auth.session-token.0",value:"a",domain:".chatgpt.com",path:"/"},
      {name:"__Secure-next-auth.session-token.0",value:"b",domain:".chatgpt.com",path:"/"},
      {name:"__Secure-next-auth.session-token.1",value:"c",domain:".chatgpt.com",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError,
  );
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"__Secure-next-auth.session-token.0",value:"a",domain:".evil.example",path:"/"},
      {name:"__Secure-next-auth.session-token.1",value:"b",domain:".chatgpt.com",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError && e.code==="chatgpt_session_cookie_scope_invalid",
  );
});

test("requires a real session token and complete contiguous chunks", () => {
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"cf_clearance",value:"challenge",domain:".chatgpt.com",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError && e.code==="chatgpt_session_token_missing",
  );
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"__Secure-next-auth.session-token.0",value:"a",domain:".chatgpt.com",path:"/"},
      {name:"__Secure-next-auth.session-token.2",value:"c",domain:".chatgpt.com",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError && e.code==="chatgpt_session_token_incomplete",
  );
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"__Secure-next-auth.session-token",value:"whole",domain:".chatgpt.com",path:"/"},
      {name:"__Secure-next-auth.session-token.0",value:"a",domain:".chatgpt.com",path:"/"},
      {name:"__Secure-next-auth.session-token.1",value:"b",domain:".chatgpt.com",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError && e.code==="chatgpt_session_token_ambiguous",
  );
});

test("accepts one unchunked session token", () => {
  const parsed=JSON.parse(normalisePhase5Session(JSON.stringify({cookies:[
    {name:"__Secure-next-auth.session-token",value:"whole",domain:".chatgpt.com",path:"/"},
  ]})));
  assert.deepEqual(parsed.cookies.map(c=>c.name),["__Secure-next-auth.session-token"]);
});

test("v3 encryption round-trips without exposing plaintext", () => {
  const normalised = normalisePhase5Session(rawLegacy);
  const encrypted = encryptPhase5State(normalised);
  assert.equal(encrypted.includes("opaque-0"), false);
  assert.equal(normalisePhase5Session(decryptPhase5Envelope(encrypted)), normalised);
});

test("cookie header carries the complete approved auth structure", () => {
  const state = JSON.parse(normalisePhase5Session(rawLegacy));
  const h = buildPhase5CookieHeader(state,"https://chatgpt.com/backend-api/models");
  assert.match(h,/__Secure-next-auth\.session-token\.0=opaque-0/);
  assert.match(h,/__Secure-next-auth\.session-token\.1=opaque-1/);
  assert.match(h,/__Host-next-auth\.csrf-token=csrf-opaque/);
  assert.match(h,/oai-did=supporting-device/);
  assert.match(h,/_account=supporting-account/);
  assert.doesNotMatch(h,/cf_clearance=/);
});

test("rotation updates only already-approved names", () => {
  const state = JSON.parse(normalisePhase5Session(rawLegacy));
  const updates = extractPhase5Rotations(
    ["__Secure-next-auth.session-token.0=rotated; Path=/; Secure","new_cookie=ignore; Path=/"],
    state.cookies.map(c=>c.name),
  );
  assert.deepEqual(updates,{"__Secure-next-auth.session-token.0":"rotated"});
  const rotated = applyPhase5Rotations(state,[
    "__Secure-next-auth.session-token.0=rotated; Path=/; Secure",
    "new_cookie=ignore; Path=/",
  ]);
  assert.equal(rotated.changed,true);
  assert.equal(rotated.state.cookies.find(c=>c.name==="__Secure-next-auth.session-token.0").value,"rotated");
  assert.equal(rotated.state.cookies.some(c=>c.name==="new_cookie"),false);
});

function legacyEnvelope(plaintext) {
  const key = Buffer.from(process.env.CHATGPT_SESSION_ENCRYPTION_KEY,"hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm",key,iv);
  cipher.setAAD(Buffer.from("topratedseotools:chatgpt:session_state_json:v1","utf8"));
  const ct=Buffer.concat([cipher.update(plaintext,"utf8"),cipher.final()]);
  return JSON.stringify({
    v:1,alg:"A256GCM",iv:iv.toString("base64"),
    tag:cipher.getAuthTag().toString("base64"),ct:ct.toString("base64"),
  });
}

test("single-account loader auto-migrates legacy v2 row", async () => {
  const encrypted = legacyEnvelope(rawLegacy);
  let patchBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (input, init={}) => {
    const u=new URL(String(input));
    if(u.hostname==="db.example" && u.pathname.endsWith("/tool_accounts")){
      return Response.json([{id:"account-1",tool_slug:"chatgpt",enabled:true,status:"working",expires_at:null}]);
    }
    if(u.hostname==="db.example" && u.pathname.endsWith("/tool_authorized_sessions")){
      if((init.method||"GET")==="PATCH"){
        patchBody=JSON.parse(init.body);
        return Response.json([patchBody]);
      }
      return Response.json([{
        tool_slug:"chatgpt",encrypted_payload:encrypted,
        session_format:"chatgpt_session_state_json_v2",status:"stored",updated_at:null,
      }]);
    }
    throw new Error("unexpected fetch "+String(input));
  };
  try{
    const loaded=await loadSingleAccountSession("account-1");
    assert.equal(loaded.state.version,3);
    assert.equal(loaded.state.cookies.length,10);
    assert.equal(patchBody.session_format,CHATGPT_SESSION_FORMAT);
    assert.equal(patchBody.encrypted_payload.includes("opaque-0"),false);
  } finally { global.fetch=originalFetch; }
});

test("single-account loader rejects wrong assigned account", async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const u=new URL(String(input));
    if(u.hostname==="db.example" && u.pathname.endsWith("/tool_accounts")){
      return Response.json([{id:"account-1",tool_slug:"chatgpt",enabled:true,status:"working",expires_at:null}]);
    }
    throw new Error("unexpected fetch");
  };
  try{
    await assert.rejects(
      () => loadSingleAccountSession("another-account"),
      e => e instanceof Phase5SessionError && e.code==="chatgpt_account_mismatch",
    );
  } finally { global.fetch=originalFetch; }
});

test("proxy keeps upstream auth server-side and strips Set-Cookie", async () => {
  const state=normalisePhase5Session(rawLegacy);
  const encrypted=encryptPhase5State(state);
  const seen={};
  const originalFetch=global.fetch;
  global.fetch=async (input,init={})=>{
    const u=new URL(String(input));
    if(u.hostname==="db.example" && u.pathname.endsWith("/tool_accounts")){
      return Response.json([{id:"account-1",tool_slug:"chatgpt",enabled:true,status:"working",expires_at:null}]);
    }
    if(u.hostname==="db.example" && u.pathname.endsWith("/tool_authorized_sessions")){
      if((init.method||"GET")==="PATCH") return Response.json([JSON.parse(init.body)]);
      return Response.json([{
        tool_slug:"chatgpt",encrypted_payload:encrypted,
        session_format:CHATGPT_SESSION_FORMAT,status:"stored",updated_at:null,
      }]);
    }
    if(u.hostname==="chatgpt.com"){
      seen.cookie=new Headers(init.headers).get("cookie");
      return new Response('{"url":"https://chatgpt.com/c/1"}',{
        status:200,
        headers:{
          "content-type":"application/json",
          "set-cookie":"__Secure-next-auth.session-token.0=rotated; Path=/; Secure; HttpOnly",
        },
      });
    }
    throw new Error("unexpected fetch "+String(input));
  };
  try{
    const request=new Request("https://chatgpt.topratedseotools.com/backend-api/models",{
      headers:{accept:"application/json"},
    });
    const route={
      target:new URL("https://chatgpt.com/backend-api/models"),
      targetOrigin:"https://chatgpt.com",
      secondaryHost:false,
      kind:"http",
    };
    const response=await proxyWithSingleChatGptSession(request,route,{
      entitlement:{account:"account-1"},
    });
    assert.equal(response.status,200);
    assert.match(seen.cookie,/__Secure-next-auth\.session-token\.0=opaque-0/);
    assert.match(seen.cookie,/__Secure-next-auth\.session-token\.1=opaque-1/);
    assert.equal(response.headers.get("set-cookie"),null);
    assert.equal((await response.text()).includes("https://chatgpt.com"),false);
  } finally { global.fetch=originalFetch; }
});

test("edge challenge fails closed without bypass", async () => {
  const state=normalisePhase5Session(rawLegacy);
  const encrypted=encryptPhase5State(state);
  const originalFetch=global.fetch;
  global.fetch=async (input,init={})=>{
    const u=new URL(String(input));
    if(u.hostname==="db.example" && u.pathname.endsWith("/tool_accounts")){
      return Response.json([{id:"account-1",tool_slug:"chatgpt",enabled:true,status:"working",expires_at:null}]);
    }
    if(u.hostname==="db.example" && u.pathname.endsWith("/tool_authorized_sessions")){
      return Response.json([{
        tool_slug:"chatgpt",encrypted_payload:encrypted,
        session_format:CHATGPT_SESSION_FORMAT,status:"stored",updated_at:null,
      }]);
    }
    if(u.hostname==="chatgpt.com"){
      return new Response("challenge",{status:403,headers:{"cf-mitigated":"challenge"}});
    }
    throw new Error("unexpected");
  };
  try{
    const request=new Request("https://chatgpt.topratedseotools.com/");
    const route={
      target:new URL("https://chatgpt.com/"),
      targetOrigin:"https://chatgpt.com",
      secondaryHost:false,
      kind:"http",
    };
    await assert.rejects(
      () => proxyWithSingleChatGptSession(request,route,{entitlement:{account:"account-1"}}),
      e => e instanceof Phase5SessionError && e.code==="upstream_edge_challenge",
    );
  } finally { global.fetch=originalFetch; }
});
