/**
 * Phase 4 — StealthWriter provider-aware proxy routing.
 *
 * Protects the routing boundary:
 * - proxy sessions are sticky to one provider account;
 * - launch tickets capture the customer's assignment;
 * - assignment changes revoke old proxy sessions;
 * - Account 1 rotations keep the legacy rollback vault synchronized;
 * - Account 2 rotations update only Account 2;
 * - no automatic provider fallback or load balancing is introduced.
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
  "supabase/migrations/20260925100103_stealthwriter_provider_routing.sql",
  "utf8",
);
const proxy = readFileSync(
  "src/lib/stealthwriter-proxy.server.ts",
  "utf8",
);
const controls = readFileSync(
  "src/lib/stealthwriter-controls.server.ts",
  "utf8",
);
const adminFns = readFileSync(
  "src/lib/stealthwriter-controls.functions.ts",
  "utf8",
);

assert(
  migration.includes("provider_account_key text") &&
    migration.includes("set provider_account_key = 'account_1'") &&
    migration.includes("alter column provider_account_key set not null"),
  "existing proxy sessions are preserved as sticky Account 1 sessions",
);

assert(
  migration.includes("stealthwriter_proxy_sessions_provider_account_fkey") &&
    migration.includes("references public.stealthwriter_provider_accounts(account_key)") &&
    migration.includes("stealthwriter_proxy_sessions_provider_account_idx"),
  "proxy-session provider binding has referential integrity and an index",
);

assert(
  controls.includes('export type StealthWriterProviderAccountKey = "account_1" | "account_2"') &&
    controls.includes("isStealthWriterProviderAccountKey"),
  "provider routing accepts only the two approved account keys",
);

assert(
  proxy.includes('.from("stealthwriter_provider_accounts")') &&
    proxy.includes('.eq("account_key", providerAccountKey)') &&
    proxy.includes("provider_account_key: providerAccountKey"),
  "launches load the assigned provider vault and bind it to the proxy session",
);

assert(
  proxy.includes("controls.provider_account_key !== row.provider_account_key") &&
    proxy.includes("proxy account assignment changed") &&
    proxy.includes("status: \"revoked\""),
  "stale launch/active sessions are rejected after reassignment",
);

assert(
  proxy.includes("loadEncryptedStealthWriterSession(providerAccountKey)") &&
    proxy.includes("persistRotatedStealthWriterCookies(providerAccountKey, upstream)"),
  "all canonical upstream traffic uses and rotates the sticky provider account",
);

assert(
  proxy.includes('if (providerAccountKey === "account_1")') &&
    proxy.includes('.from("tool_authorized_sessions")') &&
    proxy.includes('.from("stealthwriter_provider_accounts")'),
  "Account 1 rotation preserves the rollback vault while Account 2 rotates independently",
);

assert(
  adminFns.includes("previousControls") &&
    adminFns.includes("providerChanged") &&
    adminFns.includes('data.status !== "active" || providerChanged') &&
    adminFns.includes("proxy sessions revoked"),
  "Admin reassignment revokes the customer's old proxy sessions",
);

assert(
  !proxy.includes("Math.random") &&
    !proxy.includes("fallbackProvider") &&
    !proxy.includes("roundRobin"),
  "Phase 4 adds no automatic fallback, random routing, or round-robin balancing",
);

console.log(
  `stealthwriter-provider-routing: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
