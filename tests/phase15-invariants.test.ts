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
if (!selfHostedPath.includes("launchSelfHostedBrowser(context.userId, data.tool_slug)")) {
  throw new Error("Self Hosted launch must remain bound to authenticated user and configured tool");
}

const migration = readFileSync(
  "supabase/migrations/20260912010000_phase15_self_hosted_provider.sql",
  "utf8",
);
if (/default_provider[\s\S]*self_hosted/i.test(migration)) {
  throw new Error("Phase 15 migration must not replace the Browser Use default");
}

console.log("phase15-invariants: grants, saved auth, writer binding, and rollback preserved");
