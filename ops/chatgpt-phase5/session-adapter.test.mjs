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
    { name: "auth_a", value: "opaque-a", domain: ".chatgpt.com", path: "/" },
    { name: "auth_b", value: "opaque-b", domain: ".chatgpt.com", path: "/" },
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
  assert.deepEqual(parsed.cookies.map(c => c.name), ["auth_a", "auth_b"]);
  assert.equal("session_tokens" in parsed, false);
  assert.equal(JSON.stringify(parsed).includes("must-not-survive"), false);
});

test("preserves opaque values exactly", () => {
  const parsed = JSON.parse(normalisePhase5Session(rawLegacy));
  assert.equal(parsed.cookies[0].value, "opaque-a");
  assert.equal(parsed.cookies[1].value, "opaque-b");
});

test("rejects duplicate names and unrelated domains", () => {
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"dup",value:"a",domain:".chatgpt.com",path:"/"},
      {name:"dup",value:"b",domain:".chatgpt.com",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError,
  );
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"auth",value:"a",domain:".evil.example",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError,
  );
});

test("rejects challenge-only state", () => {
  assert.throws(
    () => normalisePhase5Session(JSON.stringify({cookies:[
      {name:"cf_clearance",value:"challenge",domain:".chatgpt.com",path:"/"},
    ]})),
    e => e instanceof Phase5SessionError,
  );
});

test("v3 encryption round-trips without exposing plaintext", () => {
  const normalised = normalisePhase5Session(rawLegacy);
  const encrypted = encryptPhase5State(normalised);
  assert.equal(encrypted.includes("opaque-a"), false);
  assert.equal(normalisePhase5Session(decryptPhase5Envelope(encrypted)), normalised);
});

test("cookie header respects domain and path", () => {
  const state = JSON.parse(normalisePhase5Session(JSON.stringify({cookies:[
    {name:"root",value:"r",domain:".chatgpt.com",path:"/"},
    {name:"api",value:"a",domain:".chatgpt.com",path:"/backend-api"},
    {name:"openai",value:"o",domain:".openai.com",path:"/"},
  ]})));
  const h = buildPhase5CookieHeader(state,"https://chatgpt.com/backend-api/models");
  assert.match(h,/root=r/);
  assert.match(h,/api=a/);
  assert.doesNotMatch(h,/openai=o/);
});

test("rotation updates only already-approved names", () => {
  const state = JSON.parse(normalisePhase5Session(rawLegacy));
  const updates = extractPhase5Rotations(
    ["auth_a=rotated; Path=/; Secure","new_cookie=ignore; Path=/"],
    state.cookies.map(c=>c.name),
  );
  assert.deepEqual(updates,{auth_a:"rotated"});
  const rotated = applyPhase5Rotations(state,[
    "auth_a=rotated; Path=/; Secure",
    "new_cookie=ignore; Path=/",
  ]);
  assert.equal(rotated.changed,true);
  assert.equal(rotated.state.cookies.find(c=>c.name==="auth_a").value,"rotated");
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
    assert.equal(loaded.state.cookies.length,2);
    assert.equal(patchBody.session_format,CHATGPT_SESSION_FORMAT);
    assert.equal(patchBody.encrypted_payload.includes("opaque-a"),false);
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
          "set-cookie":"auth_a=rotated; Path=/; Secure; HttpOnly",
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
    assert.match(seen.cookie,/auth_a=opaque-a/);
    assert.match(seen.cookie,/auth_b=opaque-b/);
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
