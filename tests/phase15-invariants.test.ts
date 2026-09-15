import { readFileSync } from "node:fs";

const source = readFileSync("src/lib/session-only-access.functions.ts", "utf8");
const start = source.indexOf("if (!usesWebsiteSavedBrowserState(provider))");
const end = source.indexOf("const { data: saved }", start);
if (start < 0 || end < 0) throw new Error("Self Hosted isolation boundary is missing");
const selfHostedPath = source.slice(start, end);

if (selfHostedPath.includes('from("tool_account_sessions")')) {
  throw new Error("Self Hosted path must not read or write website-saved authentication");
}
if (/from\("tool_access_grants"\)[\s\S]*\.(update|delete)\(/.test(selfHostedPath)) {
  throw new Error("Self Hosted path must not mutate customer grants");
}
if (!selfHostedPath.includes("launchSelfHostedBrowser(context.userId, data.tool_slug, accountId)")) {
  throw new Error("Self Hosted launch must remain bound to authenticated user, configured tool, and assigned account");
}

const migration = readFileSync(
  "supabase/migrations/20260912010000_phase15_self_hosted_provider.sql",
  "utf8",
);
if (/default_provider[\s\S]*self_hosted/i.test(migration)) {
  throw new Error("Phase 15 migration must not replace the Browser Use default");
}

console.log("phase15-invariants: grants, saved auth, writer binding, and rollback preserved");

const adminAuth = readFileSync("src/lib/admin-account-auth.functions.ts", "utf8");
const selfHostedStart = adminAuth.indexOf("launchSelfHostedAdminAuthentication(");
const browserUseStart = adminAuth.indexOf("launchBrowserUseInteractive(admin");
if (selfHostedStart < 0) {
  throw new Error("admin Secure Login does not launch the Self Hosted runtime");
}
if (browserUseStart < 0) {
  throw new Error("admin Secure Login no longer preserves the Browser Use launch path");
}

const selfHostedCompletionStart = adminAuth.indexOf('if (provider === "self_hosted")', selfHostedStart);
const browserCompletionStart = adminAuth.indexOf("const cdp =", selfHostedCompletionStart);
const selfHostedCompletion = adminAuth.slice(selfHostedCompletionStart, browserCompletionStart);
if (!selfHostedCompletion.includes("approveSelfHostedAdminAuthentication(")) {
  throw new Error("Self Hosted admin authentication is not approved through the runtime");
}
if (selfHostedCompletion.includes('from("tool_account_sessions")')) {
  throw new Error("Self Hosted admin handoff must not overwrite website-saved Browser Use state");
}
if (selfHostedCompletion.includes('from("tool_access_grants")')) {
  throw new Error("Self Hosted admin handoff must not modify grants");
}

const runtimeClient = readFileSync("src/lib/self-hosted-runtime.server.ts", "utf8");
if (!runtimeClient.includes("account_id: accountId")) {
  throw new Error("Self Hosted runtime requests must carry the resolved account identity");
}
const accessFunctions = readFileSync("src/lib/access.functions.ts", "utf8");
if (!accessFunctions.includes('data.auth_provider === "self_hosted"') || !accessFunctions.includes("supportsSelfHostedBrowser(data.tool_slug)")) {
  throw new Error("Admin settings must reject unsupported Self Hosted tools");
}
