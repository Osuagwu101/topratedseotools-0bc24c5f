/**
 * Phase 4 source-conformance checks.
 * These assertions protect the video/AWS trust boundaries from accidental
 * regression without requiring real StealthWriter credentials in CI.
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

const sessionFn = readFileSync("src/lib/stealthwriter-session.functions.ts", "utf8");
const proxy = readFileSync("src/lib/stealthwriter-proxy.server.ts", "utf8");
const launcher = readFileSync("src/lib/tool-launcher.ts", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260925031011_stealthwriter_session_vault.sql",
  "utf8",
);

// Video: admin session is replaceable/write-only and status does not return secrets.
assert(
  sessionFn.includes('.upsert(') && sessionFn.includes('{ onConflict: "tool_slug" }'),
  "admin save replaces the one StealthWriter vault row",
);
const statusSection = sessionFn.slice(
  sessionFn.indexOf("adminGetStealthWriterSessionStatus"),
  sessionFn.indexOf("const saveInput"),
);
assert(
  !statusSection.includes("encrypted_payload") &&
    !statusSection.includes("session_data"),
  "admin status endpoint never reads/returns the stored secret payload",
);
assert(
  sessionFn.includes("stealthwriter.authorized_session_replace") &&
    sessionFn.includes("secret values were not logged"),
  "admin replacement is audited without secret values",
);

// Phase 2 database boundary.
assert(
  migration.includes("revoke all on table public.tool_authorized_sessions from anon") &&
    migration.includes("revoke all on table public.tool_authorized_sessions from authenticated"),
  "browser clients cannot read the StealthWriter session vault table",
);

// AWS: fixed-host proxy, never open proxy.
assert(
  proxy.includes('STEALTHWRITER_UPSTREAM_ORIGIN = "https://stealthwriter.ai"'),
  "proxy upstream is fixed to StealthWriter",
);
assert(
  !proxy.includes("target_url") && !proxy.includes("upstream_url"),
  "customer request cannot select an arbitrary upstream host",
);

// AWS proxy.php: rotated cookies are persisted but Set-Cookie is never exposed.
assert(
  proxy.includes("persistRotatedStealthWriterCookies(upstream)"),
  "upstream Better Auth cookie rotations are persisted",
);
assert(
  proxy.includes("Never forward Set-Cookie") &&
    !proxy.match(/headers\.set\(["']Set-Cookie["']/),
  "upstream Set-Cookie is not forwarded to customers",
);

// AWS index.php: master account surfaces stay blocked.
for (const fragment of ["/logout", "/billing", "/account", "/subscription"]) {
  assert(proxy.includes(`"${fragment}"`), `proxy blocks ${fragment} paths`);
}

// Customer launch is StealthWriter-only and intercepted before the normal app route.
assert(
  launcher.includes('tool.slug === "stealthwriter"') &&
    launcher.includes("startStealthWriterProxyLaunch"),
  "only StealthWriter uses the new proxy launcher",
);
const fetchBody = server.slice(server.indexOf("async fetch(request"));
assert(
  fetchBody.includes('url.pathname === "/api/stealthwriter-proxy"') &&
    fetchBody.indexOf('url.pathname === "/api/stealthwriter-proxy"') <
      fetchBody.indexOf("const handler = await getServerEntry()"),
  "proxy requests are handled server-side before the React application",
);

console.log(
  `stealthwriter-phase4-source-conformance: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
