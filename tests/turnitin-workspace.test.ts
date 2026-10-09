/**
 * Turnitin Phase 4 — isolated customer workspace UI.
 * Run: bun tests/turnitin-workspace.test.ts
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

const legacyRoute = readFileSync("src/routes/tools.$slug.tsx", "utf8");
const productPage = readFileSync(
  "src/components/turnitin/TurnitinProductPage.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const funcs = readFileSync("src/lib/turnitin.functions.ts", "utf8");
const tools = readFileSync("src/lib/tools-data.ts", "utf8");

assert(
  legacyRoute.includes('params.slug === "turnitin"') &&
    legacyRoute.includes('redirect({ to: "/turnitin" })') &&
    productPage.includes("<TurnitinWorkspace") &&
    legacyRoute.includes('tool.pricingModel === "per_use"'),
  "legacy Turnitin tool URLs redirect to the dedicated product while generic per-use tools remain intact",
);

assert(
  workspace.includes("Available credits") &&
    workspace.includes("Reserved") &&
    workspace.includes("Next expiry") &&
    workspace.includes("₦2,300") &&
    workspace.includes("TURNITIN_CREDIT_UNIT_PRICE_NGN"),
  "workspace exposes credit balance, reservation, expiry and the ₦2,300 unit-price model",
);

assert(
  workspace.includes("Number of checks") &&
    workspace.includes("TURNITIN_CREDIT_MAX_QUANTITY") &&
    workspace.includes("quantity * UNIT_PRICE_NGN"),
  "credit purchase UI accepts arbitrary quantities and calculates the total",
);

for (const label of [
  "Exclude bibliography",
  "Exclude quotes",
  "Exclude cited text",
  "Exclude small matches",
]) {
  assert(workspace.includes(label), `workspace exposes ${label}`);
}

assert(
  workspace.includes('accept=".pdf,.doc,.docx') &&
    workspace.includes("MAX_FILE_BYTES = 100 * 1024 * 1024") &&
    workspace.includes("drag and drop"),
  "document picker accepts PDF/DOC/DOCX and enforces the 100 MB UI limit",
);

assert(
  workspace.includes("smallMatchMode") &&
    workspace.includes('"words" | "percent"') &&
    workspace.includes("smallMatchThreshold"),
  "small-match exclusion exposes word/percentage threshold controls",
);


assert(
  workspace.includes("Submission details") &&
    workspace.includes('useState("Top Rated")') &&
    workspace.includes('useState("Writing Services")') &&
    workspace.includes("Author first name") &&
    workspace.includes("Author last name"),
  "upload area exposes editable author defaults for Top Rated Writing Services",
);

assert(
  workspace.includes("reportTitle.trim() || selectedFile.name") &&
    workspace.includes("authorFirstName.trim() || null") &&
    workspace.includes("authorLastName.trim() || null"),
  "the exact TRST title/author values are submitted with the Turnitin job",
);

assert(
  workspace.includes('useState<"sources" | "match_groups">("sources")') &&
    workspace.includes("Similarity report view") &&
    workspace.includes("Classic layout with numbered, colour-coded sources") &&
    workspace.includes("Highlights coloured by match group"),
  "upload area offers Sources/Match groups and defaults to Sources",
);

for (const requirement of [
  "Requirements for AI Detection",
  "at least 300 words in paragraph format",
  "30,000 words for AI detection",
  "English, Spanish, or Japanese",
  "file must be under 100 MB",
]) {
  assert(
    workspace.toLowerCase().includes(requirement.toLowerCase()),
    `upload area states Originality requirement: ${requirement}`,
  );
}

assert(
  workspace.includes("This check will use 1 credit after Originality Reports accepts the document") &&
    workspace.includes("summary.available_credits"),
  "upload area shows the one-credit rule and the user's current available balance",
);

assert(
  workspace.includes("Search document name") &&
    workspace.includes("name.includes(q)") &&
    workspace.includes("Check history"),
  "check history is searchable by uploaded document name",
);

for (const state of ["Uploading", "Queued", "Processing", "Completed", "Failed"]) {
  assert(workspace.includes(state), `workspace renders the ${state} status`);
}

assert(
  workspace.includes("Similarity") &&
    workspace.includes("AI") &&
    workspace.includes("<Score value={job.similarity_percentage}") &&
    workspace.includes("value={job.ai_percentage}") &&
    workspace.includes("asterisk={shouldShowOriginalityAsteriskPercent({") &&
    (workspace.match(/label="Download"/g) ?? []).length === 4,
  "history shows separate similarity/AI scores and downloads on desktop and mobile",
);

assert(
  funcs.includes("turnitin_my_credit_summary") &&
    funcs.includes('.from("turnitin_jobs")') &&
    funcs.includes('.from("turnitin_reports")'),
  "workspace reads only the isolated Turnitin foundation",
);

assert(
  funcs.includes("createSignedUrl") &&
    funcs.includes('.eq("user_id", context.userId)') &&
    funcs.includes("60"),
  "report downloads are ownership-checked and delivered with short-lived signed URLs",
);

assert(
  funcs.includes("turnitinReportDownloadName") &&
    funcs.includes('reportType === "ai" ? "AI_" : "si_"') &&
    funcs.includes(".pdf"),
  "report downloads preserve the uploaded filename stem with AI_ and si_ PDF prefixes",
);

assert(
  funcs.includes("download: filename") &&
    workspace.includes('document.createElement("a")') &&
    workspace.includes("link.download = result.filename") &&
    !workspace.includes('window.open(result.url'),
  "report buttons use direct attachment downloads instead of opening the PDF viewer in a new tab",
);

assert(
  workspace.includes("Buy check credits") &&
    workspace.includes("Run Turnitin check") &&
    workspace.includes("Existing tool subscriptions are not used"),
  "workspace keeps Turnitin credit purchase and document submission isolated from subscriptions",
);

for (const forbidden of [
  "startStealthWriter",
  "Phrasly",
  "ChatGPT",
  "tool_orders",
  "tool_payments",
  "PAYSTACK_SECRET_KEY",
  "originality.report/user/upload",
]) {
  assert(
    !workspace.includes(forbidden) && !funcs.includes(forbidden),
    `Phase 4 does not couple the Turnitin workspace to unrelated/live surface: ${forbidden}`,
  );
}

const readOnlyHandlers = funcs.split("export const deleteMyTurnitinCheck =")[0];
for (const mutation of [".insert(", ".update(", ".delete(", ".upsert("]) {
  assert(
    !readOnlyHandlers.includes(mutation),
    `Phase 4 workspace and download handlers stay read-only: no ${mutation}`,
  );
}
assert(
  funcs.includes("deleteMyTurnitinCheck = createServerFn") &&
    funcs.includes('.eq("user_id", context.userId)'),
  "new deletion action separately enforces authenticated job ownership",
);

assert(
  tools.includes("self-service Turnitin checking workspace") &&
    tools.includes("Searchable check history"),
  "Turnitin catalogue copy describes the new isolated workspace",
);

console.log(`turnitin-workspace: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
