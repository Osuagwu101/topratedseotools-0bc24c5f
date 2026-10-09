/**
 * Turnitin masked Originality AI scores: parser, history recovery and
 * integration regression tests. Run: bun tests/turnitin-ai-asterisk.test.ts
 */
import { readFileSync } from "node:fs";
import {
  isOriginalityAsteriskPercent,
  shouldShowOriginalityAsteriskPercent,
} from "../src/lib/turnitin-ai-score";

let passed = 0;
let failed = 0;
function assert(ok: boolean, message: string) {
  if (ok) { passed++; }
  else { failed++; console.error("FAIL:", message); }
}

for (const value of ["*%", "*", " * % ", "  *%  "]) {
  assert(isOriginalityAsteriskPercent(value), `recognizes Originality marker ${JSON.stringify(value)}`);
}
for (const value of ["33%", "0%", "100%", null, undefined, "", "—", "Unavailable"]) {
  assert(!isOriginalityAsteriskPercent(value), `does not misclassify ${JSON.stringify(value)}`);
}

function show(
  aiPercentage: number | null,
  aiUnavailableReason: string | null,
  jobStatus: string,
  aiReportAvailable: boolean,
) {
  return shouldShowOriginalityAsteriskPercent({
    aiPercentage, aiUnavailableReason, jobStatus, aiReportAvailable,
  });
}
assert(show(null, "*%", "completed", true), "upstream marker is preserved");
assert(show(null, "*", "completed", false), "upstream * marker works without downloadable report");
assert(show(null, null, "completed", true), "existing completed AI report recovers lost marker");
assert(!show(null, null, "completed", false), "no marker without AI report");
assert(!show(null, null, "processing", true), "pending processing report does not get a fabricated marker");
assert(!show(null, null, "failed", true), "failed check does not get a fabricated marker");
assert(!show(null, "AI detection unavailable", "completed", true), "real unavailable reason is preserved");
assert(!show(0, "*%", "completed", true), "numeric 0% wins over marker");
assert(!show(26, null, "completed", true), "numeric 26% stays numeric");

const adapter = readFileSync("src/lib/turnitin-originality.server.ts", "utf8");
const sync = readFileSync("src/lib/turnitin-jobs.functions.ts", "utf8");
const ui = readFileSync("src/components/turnitin/TurnitinWorkspace.tsx", "utf8");
assert(
  adapter.includes("aiScoreIsAsterisk: boolean") &&
  adapter.includes("isOriginalityAsteriskPercent(raw.ai_percentage ?? raw.ai_detection)") &&
  adapter.includes("isOriginalityAsteriskPercent(raw.ai_unavailable_reason)"),
  "upstream response mapping recognizes literal *% across known AI fields",
);
assert(
  sync.includes("upstream.aiScoreIsAsterisk") &&
  (sync.match(/ai_unavailable_reason: aiDisplayReason,/g) ?? []).length === 2 &&
  sync.includes("if (aiUnavailableReason)"),
  "marker persists on job without marking AI report unavailable",
);
assert(
  (ui.match(/asterisk=\{shouldShowOriginalityAsteriskPercent\(/g) ?? []).length === 2 &&
  ui.includes('className="font-bold text-emerald-600 dark:text-emerald-400" aria-label="Originality AI score: asterisk percent"') &&
  ui.includes("> *%</span>") === false &&
  ui.includes(">*%</span>"),
  "both mobile and desktop history render *% literally",
);
assert(
  ui.includes("const scoreColour = value >= 60") &&
  ui.includes('return <span className="text-xs text-muted-foreground">Unavailable</span>') &&
  ui.includes("ReportButton"),
  "existing numeric/real-unavailable score and report-download paths remain",
);

console.log(`turnitin-ai-asterisk: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
