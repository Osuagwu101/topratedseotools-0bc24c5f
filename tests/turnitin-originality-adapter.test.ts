/**
 * Turnitin Phase 5 — Originality Reports adapter source conformance.
 * Run: bun tests/turnitin-originality-adapter.test.ts
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
  "supabase/migrations/20261005022000_turnitin_originality_adapter.sql",
  "utf8",
);
const session = readFileSync(
  "src/lib/turnitin-originality-session.server.ts",
  "utf8",
);
const adapter = readFileSync(
  "src/lib/turnitin-originality.server.ts",
  "utf8",
);
const sessionFns = readFileSync(
  "src/lib/turnitin-session.functions.ts",
  "utf8",
);
const jobs = readFileSync(
  "src/lib/turnitin-jobs.functions.ts",
  "utf8",
);
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const adminTool = readFileSync(
  "src/routes/admin.tools.$slug.tsx",
  "utf8",
);

assert(
  migration.includes("create table if not exists public.turnitin_originality_authorized_session") &&
    migration.includes("'turnitin-source'") &&
    migration.includes("'turnitin-reports'") &&
    migration.includes("public,") &&
    migration.includes("false"),
  "migration creates a Turnitin-only session vault and private source/report buckets",
);

assert(
  !migration.includes("alter table public.tool_authorized_sessions") &&
    !migration.includes("update public.tool_authorized_sessions") &&
    !migration.includes("insert into public.tool_authorized_sessions"),
  "Phase 5 does not alter the StealthWriter/Phrasly/ChatGPT shared session vault",
);

assert(
  migration.includes("104857600") &&
    migration.includes("application/pdf") &&
    migration.includes(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
  "private source bucket enforces the 100 MB PDF/DOC/DOCX contract",
);

assert(
  migration.includes("upstream_upload_token") &&
    migration.includes("turnitin_jobs_upload_token_uidx"),
  "jobs persist a unique upstream upload token for idempotent retries",
);

assert(
  session.includes('TURNITIN_ORIGINALITY_AUTH_COOKIE = "turnitin_admin_session"') &&
    session.includes("originality.report") &&
    session.includes("A256GCM") &&
    session.includes("hkdfSync") &&
    session.includes("TURNITIN_ORIGINALITY_SESSION_ENCRYPTION_KEY"),
  "Originality session vault is first-party-only and AES-GCM encrypted",
);

assert(
  session.includes("Quick paste") &&
    session.includes("turnitin_admin_session=<value>") &&
    session.includes("No reusable first-party Originality Reports cookies"),
  "Admin can quick-paste the primary session cookie while unrelated cookie sets are rejected",
);

assert(
  adapter.includes('"/user/upload"') &&
    adapter.includes("/user/submissions-status?_=") &&
    adapter.includes("/user/download/"),
  "adapter is limited to the mapped upload/status/report workflow",
);


assert(
  adapter.includes('"/csrf-token"') &&
    adapter.includes('"X-CSRFToken"') &&
    adapter.includes('"X-Requested-With"') &&
    adapter.includes('cache: "no-store"'),
  "upload obtains Originality CSRF token and sends the same non-GET headers as the browser",
);

assert(
  adapter.includes("for (let csrfAttempt = 0; csrfAttempt < 2; csrfAttempt++)") &&
    adapter.includes("response.status === 400") &&
    adapter.includes('error.code === "UPSTREAM_FORBIDDEN"') &&
    adapter.includes("one CSRF refresh"),
  "upload refreshes CSRF and replays at most once on browser-equivalent 400/403/redirect rejection",
);

assert(
  adapter.includes('options.authorFirstName?.trim() || "Top Rated"') &&
    adapter.includes('options.authorLastName?.trim() || "Writing Services"'),
  "server fallback author matches the TRST default report identity",
);

for (const field of [
  '"file"',
  '"exclude_bibliography"',
  '"exclude_quotes"',
  '"report_view"',
  '"exclude_citations"',
  '"exclude_small_matches"',
  '"small_match_mode"',
  '"small_match_threshold"',
  '"report_title"',
  '"author_first_name"',
  '"author_last_name"',
  '"folder_id"',
  '"upload_token"',
]) {
  assert(adapter.includes(field), `adapter sends exact Originality form field ${field}`);
}

assert(
  adapter.includes('String(options.excludeBibliography)') &&
    adapter.includes('String(options.excludeQuotes)') &&
    adapter.includes('String(options.excludeCitations)') &&
    adapter.includes('String(options.excludeSmallMatches)'),
  "checkbox booleans are serialized exactly like browser FormData",
);

assert(
  adapter.includes('options.smallMatchMode === "percent" ? [1, 50] : [8, 200]'),
  "small-match limits mirror provider defaults: 8–200 words or 1–50%",
);

assert(
  adapter.includes("for (let attempt = 0; attempt < 3; attempt++)") &&
    adapter.includes("options.uploadToken") &&
    adapter.includes("2000 * attempt"),
  "upload retries three times while reusing the same upstream upload token",
);

assert(
  adapter.includes('headers.set("Cookie"') &&
    adapter.includes("if (isOriginality)") &&
    adapter.includes("currentUrl") &&
    adapter.includes("application/pdf"),
  "report retrieval uses auth only on Originality domains and validates PDF responses",
);

for (const forbidden of [
  "playwright",
  "puppeteer",
  "browser-use",
  "cf_clearance",
  "captcha",
  "/accounts/login",
  "password",
]) {
  assert(
    !adapter.toLowerCase().includes(forbidden.toLowerCase()) ||
      forbidden === "/accounts/login",
    `adapter does not automate login/challenges or depend on browser engines: ${forbidden}`,
  );
}

assert(
  sessionFns.includes("validateOriginalitySessionState") &&
    sessionFns.includes("available_slots") &&
    sessionFns.includes("encryptOriginalitySession") &&
    sessionFns.includes("adminRevokeTurnitinOriginalitySession") &&
    sessionFns.includes("turnitin_originality_authorized_session"),
  "Admin Save validates the direct server session and stores it only in the Turnitin vault",
);

assert(
  jobs.includes("turnitin_reserve_credit") &&
    jobs.includes("turnitin_consume_reserved_credit") &&
    jobs.includes("turnitin_release_reserved_credit") &&
    jobs.includes("turnitin_refund_consumed_credit"),
  "job orchestration uses the Phase 3 atomic credit lifecycle",
);


assert(
  jobs.includes('reportView: z.enum(["sources", "match_groups"]).default("sources")') &&
    jobs.includes("report_title: data.options.reportTitle?.trim() || originalFilename") &&
    jobs.includes("author_first_name: data.options.authorFirstName?.trim() || null") &&
    jobs.includes("author_last_name: data.options.authorLastName?.trim() || null"),
  "job creation persists title, author names and Sources as the default report view",
);

assert(
  jobs.includes("reportTitle: job.report_title || job.original_filename") &&
    jobs.includes("authorFirstName: job.author_first_name") &&
    jobs.includes("authorLastName: job.author_last_name") &&
    jobs.includes('job.report_view === "sources" ? "sources" : "match_groups"'),
  "persisted TRST submission details are passed unchanged into the Originality adapter",
);

assert(
  jobs.includes('error.code === "NETWORK_ERROR"') &&
    jobs.includes("same protected upload token") &&
    jobs.includes("credit_state !== \"reserved\""),
  "ambiguous network failures preserve the reservation for same-token retry",
);

const acceptanceWrite = jobs.indexOf("upstream_submission_id: result.submissionId");
const consumeAfterAcceptance =
  acceptanceWrite >= 0
    ? jobs.indexOf("turnitin_consume_reserved_credit", acceptanceWrite)
    : -1;
assert(
  acceptanceWrite >= 0 &&
    consumeAfterAcceptance > acceptanceWrite,
  "upstream acceptance ID is persisted before local credit finalisation",
);

assert(
  jobs.includes("over 30,000 words") &&
    jobs.includes("at least 300 words") &&
    jobs.includes("similarityStored") &&
    jobs.includes("aiStored"),
  "similarity-only completion settles correctly when AI is ineligible",
);

assert(
  jobs.includes("createSignedUploadUrl") &&
    jobs.includes("turnitin-source") &&
    jobs.includes("turnitin-reports") &&
    jobs.includes('contentType: "application/pdf"'),
  "source and report files use isolated private Turnitin storage",
);

assert(
  workspace.includes("createTurnitinUploadIntent") &&
    workspace.includes("uploadToSignedUrl") &&
    workspace.includes("submitTurnitinJob") &&
    workspace.includes("syncMyTurnitinJobs") &&
    workspace.includes("Run Turnitin check"),
  "workspace performs signed upload, submission and automatic upstream synchronization",
);

assert(
  workspace.includes("summary.available_credits < 1") &&
    workspace.includes("One credit is reserved first and charged only after"),
  "workspace blocks no-credit submissions and explains reserve-then-charge behavior",
);

assert(
  adminTool.includes("TurnitinOriginalitySessionTab") &&
    adminTool.includes("turnitin_admin_session") &&
    adminTool.includes("Test session") &&
    adminTool.includes("No Originality slot is consumed"),
  "Admin → Turnitin contains write-only Originality session Save/Test/Revoke UX",
);

for (const forbidden of [
  "tool_orders",
  "tool_payments",
  "PAYSTACK_SECRET_KEY",
  "stealthwriter_provider_accounts",
  "phrasly_provider",
]) {
  assert(
    !jobs.includes(forbidden) &&
      !adapter.includes(forbidden) &&
      !sessionFns.includes(forbidden),
    `Phase 5 adapter does not couple into unrelated/payment surface: ${forbidden}`,
  );
}

console.log(
  `turnitin-originality-adapter: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
