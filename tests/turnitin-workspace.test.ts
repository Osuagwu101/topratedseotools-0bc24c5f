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

const route = readFileSync("src/routes/tools.$slug.tsx", "utf8");
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const funcs = readFileSync("src/lib/turnitin.functions.ts", "utf8");
const tools = readFileSync("src/lib/tools-data.ts", "utf8");

assert(
  route.includes('tool.slug === "turnitin"') &&
    route.includes("<TurnitinWorkspace") &&
    route.includes('tool.pricingModel === "per_use"'),
  "Turnitin alone is routed to the new workspace while the generic per-use fallback remains intact",
);

assert(
  workspace.includes("Available credits") &&
    workspace.includes("Reserved") &&
    workspace.includes("Next expiry") &&
    workspace.includes("₦2,300") &&
    workspace.includes("UNIT_PRICE_NGN = 2300"),
  "workspace exposes credit balance, reservation, expiry and the ₦2,300 unit-price model",
);

assert(
  workspace.includes("Number of checks") &&
    workspace.includes("Math.min(500") &&
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
    workspace.includes("Similarity report") &&
    workspace.includes("AI report"),
  "history exposes similarity/AI scores and separate report downloads",
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
  workspace.includes("disabled") &&
    workspace.includes("dedicated credit checkout is connected in the payment phase") &&
    workspace.includes("Originality Reports adapter is connected in the next"),
  "Phase 4 keeps checkout and upstream submission deliberately disabled",
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

for (const mutation of [".insert(", ".update(", ".delete(", ".upsert("]) {
  assert(
    !funcs.includes(mutation),
    `Phase 4 server functions remain read/download-only: no ${mutation}`,
  );
}

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
