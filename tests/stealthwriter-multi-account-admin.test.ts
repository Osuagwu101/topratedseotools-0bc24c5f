/**
 * Phase 2 — StealthWriter provider-account admin management.
 *
 * Protects the phase boundary:
 * - Admin can manage Account 1 and Account 2 independently.
 * - secret payloads are write-only from the browser.
 * - Account 1 keeps using the proven legacy write path.
 * - Account 2 is independently stored.
 * - later approved phases may route customers through either stored account.
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

const sessionFn = readFileSync(
  "src/lib/stealthwriter-session.functions.ts",
  "utf8",
);
const adminRoute = readFileSync(
  "src/routes/admin.tools.$slug.tsx",
  "utf8",
);
const proxy = readFileSync(
  "src/lib/stealthwriter-proxy.server.ts",
  "utf8",
);

assert(
  sessionFn.includes('STEALTHWRITER_PROVIDER_ACCOUNT_KEYS') &&
    sessionFn.includes('"account_1"') &&
    sessionFn.includes('"account_2"'),
  "server actions restrict management to the two approved provider accounts",
);

const listStart = sessionFn.indexOf("adminListStealthWriterProviderAccounts");
const saveStart = sessionFn.indexOf("const providerSaveInput");
const listSection = sessionFn.slice(listStart, saveStart);
assert(
  listStart >= 0 &&
    saveStart > listStart &&
    listSection.includes('.from("stealthwriter_provider_accounts")') &&
    !listSection.includes("encrypted_payload"),
  "admin account listing returns metadata only and never reads encrypted session values",
);

assert(
  sessionFn.includes('if (data.account_key === "account_1")') &&
    sessionFn.includes('.from("tool_authorized_sessions")') &&
    sessionFn.includes('{ onConflict: "tool_slug" }'),
  "Account 1 replacement remains on the proven live legacy vault path",
);

assert(
  sessionFn.includes('.from("stealthwriter_provider_accounts")') &&
    sessionFn.includes('account_key: "account_2"') &&
    sessionFn.includes('{ onConflict: "account_key" }'),
  "Account 2 is saved independently in the provider-account vault",
);

assert(
  sessionFn.includes("stealthwriter.provider_session_replace") &&
    sessionFn.includes("secret values were not logged"),
  "provider-account session replacement is audited without secret material",
);

assert(
  adminRoute.includes("StealthWriter proxy accounts") &&
    adminRoute.includes("Account 1") &&
    adminRoute.includes("Account 2") &&
    adminRoute.includes("adminSaveStealthWriterProviderSession"),
  "Admin UI exposes separate controls for both proxy accounts",
);

assert(
  adminRoute.includes("Provider routing is active") &&
    adminRoute.includes("Customers assigned to Account 2"),
  "Admin UI reflects the later approved live-routing state",
);

assert(
  proxy.includes("provider_account_key") &&
    proxy.includes("stealthwriter_provider_accounts"),
  "later approved routing consumes the two provider accounts",
);

console.log(
  `stealthwriter-multi-account-admin: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
