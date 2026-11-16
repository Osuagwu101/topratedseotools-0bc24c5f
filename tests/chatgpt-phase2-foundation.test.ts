/**
 * Phase 2 ChatGPT foundation/source-boundary checks.
 * Run: bun tests/chatgpt-phase2-foundation.test.ts
 */
import { readFileSync } from "node:fs";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    failures.push(message);
    console.error("  ✗", message);
  }
}

const migration = readFileSync(
  "supabase/migrations/20260926045500_chatgpt_session_vault.sql",
  "utf8",
);
const funcs = readFileSync("src/lib/chatgpt-session.functions.ts", "utf8");
const adminRoute = readFileSync("src/routes/admin.tools.$slug.tsx", "utf8");
const legacyLauncher = readFileSync(
  "src/lib/session-only-access.functions.ts",
  "utf8",
);

assert(
  migration.includes("'stealthwriter', 'phrasly', 'chatgpt'"),
  "vault constraint explicitly adds ChatGPT without removing existing tools",
);
assert(
  funcs.includes('const TOOL_SLUG = "chatgpt"') &&
    funcs.includes("adminGetChatGptSessionStatus") &&
    funcs.includes("adminSaveChatGptSession") &&
    funcs.includes("adminRevokeChatGptSession"),
  "ChatGPT has dedicated admin-only status/save/revoke server functions",
);
assert(
  funcs.includes("secret values not logged") &&
    funcs.includes("chatgpt_session_state_json_v2") &&
    funcs.includes('.select("account_key,status,updated_at,verified_at")'),
  "admin metadata excludes session payloads and the v2 vault avoids secret logging",
);
assert(
  funcs.includes("setChatGptOneClickEnabled(admin,true)") &&
    funcs.includes('.eq("provider_account_key",data.account_key)') &&
    funcs.includes("one_click_auth_enabled: enabled"),
  "ChatGPT launch saves enable access and revocation is account-scoped",
);
assert(
  adminRoute.includes("admin-chatgpt-authorized-session") &&
    adminRoute.includes("<ChatGptAccountsCard />"),
  "Admin tool management exposes a dedicated ChatGPT authorised-session tab",
);
assert(
  adminRoute.includes('tool.slug === "phrasly" || tool.slug === "chatgpt"'),
  "ChatGPT hides legacy accounts/credentials tabs in favour of the session vault",
);
assert(
  legacyLauncher.includes('data.tool_slug === "chatgpt"') &&
    legacyLauncher.includes("ChatGPT secure launch is not enabled yet"),
  "legacy Browser Use/session-only launch is blocked for ChatGPT during Phase 2",
);
assert(
  !funcs.includes("launch_url") &&
    !funcs.includes("browser_use") &&
    !funcs.includes("cloudflare"),
  "Phase 2 ChatGPT session functions expose no writer/browser-provider launch path",
);

console.log(`chatgpt-phase2-foundation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
