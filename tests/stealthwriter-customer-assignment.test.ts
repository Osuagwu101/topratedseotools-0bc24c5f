/**
 * Phase 3 — StealthWriter customer provider-account assignment.
 *
 * Protects the phase boundary:
 * - every existing/new customer defaults to Account 1;
 * - Admin can store Account 1 or Account 2 on the customer controls;
 * - only configured provider accounts may be assigned;
 * - assignment remains server/admin-only;
 * - proxy routing still ignores the assignment in Phase 3.
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
  "supabase/migrations/20260925085318_stealthwriter_customer_assignment.sql",
  "utf8",
);
const serverControls = readFileSync(
  "src/lib/stealthwriter-controls.server.ts",
  "utf8",
);
const adminFns = readFileSync(
  "src/lib/stealthwriter-controls.functions.ts",
  "utf8",
);
const customerAdmin = readFileSync(
  "src/routes/admin.customers.$userId.tsx",
  "utf8",
);
const proxy = readFileSync(
  "src/lib/stealthwriter-proxy.server.ts",
  "utf8",
);
const customerDashboard = readFileSync(
  "src/lib/stealthwriter-controls.functions.ts",
  "utf8",
);

assert(
  migration.includes("provider_account_key text") &&
    migration.includes("set provider_account_key = 'account_1'") &&
    migration.includes("alter column provider_account_key set default 'account_1'") &&
    migration.includes("alter column provider_account_key set not null"),
  "migration preserves existing customers on Account 1 and defaults new customers to Account 1",
);

assert(
  migration.includes("stealthwriter_user_controls_provider_account_fkey") &&
    migration.includes("references public.stealthwriter_provider_accounts(account_key)"),
  "assignment is constrained to a real provider-account record",
);

assert(
  serverControls.includes("provider_account_key: string") &&
    serverControls.includes("provider_account_key") &&
    serverControls.includes('provider_account_key: "account_1"'),
  "server customer controls persist the provider-account assignment",
);

assert(
  adminFns.includes('provider_account_key: z.enum(["account_1", "account_2"])') &&
    adminFns.includes('.from("stealthwriter_provider_accounts")') &&
    adminFns.includes('.eq("status", "stored")'),
  "Admin update accepts only Account 1/2 and requires the chosen account to be configured",
);

assert(
  adminFns.includes("provider_accounts") &&
    adminFns.includes("stealthwriter.customer_controls_update") &&
    adminFns.includes("provider="),
  "Admin controls return provider metadata and audit assignment changes",
);

assert(
  customerAdmin.includes("Proxy account assignment") &&
    customerAdmin.includes("data?.provider_accounts") &&
    customerAdmin.includes('e.target.value === "account_2"') &&
    customerAdmin.includes("Phase 3 stores this assignment only"),
  "customer Admin page exposes the assignment with the Phase 3 routing warning",
);

const experienceStart = customerDashboard.indexOf("getMyStealthWriterExperience");
const experienceEnd = customerDashboard.indexOf("removeMyStealthWriterDevice");
const experience = customerDashboard.slice(experienceStart, experienceEnd);
assert(
  !experience.includes("provider_account_key"),
  "customer-facing dashboard API does not expose internal provider assignment",
);

assert(
  !proxy.includes("provider_account_key") &&
    !proxy.includes("stealthwriter_provider_accounts"),
  "proxy routing remains unchanged during Phase 3",
);

console.log(
  `stealthwriter-customer-assignment: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
