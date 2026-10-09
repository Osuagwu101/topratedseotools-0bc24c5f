/** Regression coverage for the compact Turnitin overview and submission dialog. */
import { readFileSync } from "node:fs";

const page = readFileSync("src/components/turnitin/TurnitinProductPage.tsx", "utf8");
const workspace = readFileSync("src/components/turnitin/TurnitinWorkspace.tsx", "utf8");
let failures = 0;
function check(value: boolean, message: string) {
  if (!value) { failures++; console.error("FAIL:", message); }
  else console.log("PASS:", message);
}

check(page.includes("DialogContent") && page.includes("view=\"submit\"") &&
  page.includes("onSubmitSuccess") && page.includes("closeSubmit()") &&
  page.includes('aria-haspopup="dialog"') && page.includes('onClick={() => setSubmitOpen(true)}'),
  "top-right Submit File button opens the existing closable upload dialog");
check(page.includes('section === "submit" ? "overview" : section') &&
  page.includes('navigate({ to: "/turnitin" })'),
  "direct Submit URL renders Overview behind form and returns to Overview on close");

check(
  page.includes('to: "/turnitin", label: "Overview"') &&
  page.includes('to: "/turnitin/buy", label: "Buy Checks"') &&
  !page.includes('to: "/turnitin/submit", label: "Submit File"') &&
  !page.includes('to: "/turnitin/history", label: "History"'),
  "only Overview and Buy Checks remain in top navigation",
);
check(
  !workspace.includes('aria-label="Quick actions"') &&
  page.includes('tab.section === "buy"') &&
  page.includes('Submit File\n            </button>') &&
  page.includes("ml-auto rounded-lg bg-gradient-primary") &&
  !workspace.includes('<Link to="/turnitin/buy"'),
  "only top-right Buy Checks and Submit File buttons remain; lower action card is removed",
);
check(workspace.includes('id="turnitin-check-history"') &&
  workspace.includes('view === "history" || view === "overview"') &&
  !workspace.includes("Recent checks") &&
  workspace.includes("Search document name"),
  "full searchable history replaces Recent Checks on Overview");
check(!workspace.includes('aria-label="Quick actions"') &&
  workspace.includes("px-3 py-3 shadow-sm") &&
  workspace.includes("text-xl font-bold leading-tight"),
  "Overview keeps compact statistic cards without a duplicate action-card row");
check(workspace.includes("setExcludeBibliography] = useState(true)") &&
  workspace.includes("setExcludeQuotes] = useState(true)") &&
  workspace.includes("setExcludeCitations] = useState(false)") &&
  workspace.includes("setExcludeSmallMatches] = useState(false)"),
  "bibliography and quotes default on; cited text and small matches default off");
check(workspace.includes("onChange={setExcludeBibliography}") &&
  workspace.includes("onChange={setExcludeQuotes}") &&
  workspace.includes("excludeBibliography,") &&
  workspace.includes("excludeQuotes,"),
  "defaults are user-editable and sent in actual upload options");
check(!workspace.includes("One credit is reserved first and charged only after") &&
  workspace.includes("This check will use 1 credit after"),
  "redundant under-button disclaimer removed without hiding credit information");
check(workspace.includes("await submitTurnitinJob") &&
  workspace.includes("await qc.invalidateQueries") &&
  workspace.includes("onSubmitSuccess?.()"),
  "confirmed submission refreshes workspace and returns to Overview");
check((workspace.match(/label="Download"/g) || []).length === 4 &&
  workspace.includes('value >= 50 ? "text-red-700"') &&
  workspace.includes('value >= 30 ? "text-amber-700"'),
  "desktop/mobile history place color-coded scores over their report download actions");

console.log(`turnitin-overview-dialog: ${11 - failures} passed, ${failures} failed`);
if (failures) process.exit(1);
