/** Turnitin toolbar placement and History-column regression checks. */
import { readFileSync } from "node:fs";

const page = readFileSync("src/components/turnitin/TurnitinProductPage.tsx", "utf8");
const workspace = readFileSync("src/components/turnitin/TurnitinWorkspace.tsx", "utf8");
let failures = 0;
let passes = 0;
function assert(condition: boolean, description: string) {
  if (condition) { passes++; console.log("PASS", description); }
  else { failures++; console.error("FAIL", description); }
}
const nav = page.slice(page.indexOf("<nav\n"), page.indexOf("</nav>") + "</nav>".length);
const historyTable = workspace.slice(workspace.indexOf("<table className="), workspace.indexOf("</table>") + "</table>".length);
const headings = historyTable.slice(historyTable.indexOf("<thead"), historyTable.indexOf("</thead>") + "</thead>".length);
const row = workspace.slice(workspace.indexOf("function HistoryRow({"), workspace.indexOf("function HistoryCard({"));

assert(nav.includes('label: "Overview"') === false &&
  nav.includes("TABS.map") && nav.includes('to={tab.to}') &&
  nav.includes('onClick={() => setSubmitOpen(true)}'),
  "Overview tab and Submit File dialog trigger share the top toolbar");

assert(
  nav.includes('ml-auto rounded-lg bg-gradient-primary') &&
  nav.includes("text-white shadow-glow") &&
  nav.includes('aria-haspopup="dialog"'),
  "Buy Checks and Submit File use brand gradient and white text");

assert(
  nav.indexOf("TABS.map") < nav.indexOf("Submit File\n            </button>") &&
  nav.includes('bg-gradient-primary px-3 py-2.5 text-xs font-semibold text-white'),
  "Submit File follows Buy Checks at the top right");

assert(
  !workspace.includes('aria-label="Quick actions"') &&
  !workspace.includes('<span className="block text-sm font-semibold">Submit file</span>') &&
  workspace.includes('id="turnitin-check-history"'),
  "no duplicate Submit File card, while complete Overview history stays visible");

const headerNames = ["Document", "Status", "Similarity", "AI", "Submitted", "Actions"];
const headerIndexes = headerNames.map(name => headings.indexOf(">" + name + "</th>"));
assert(
  headerIndexes.every(index => index >= 0) &&
  headerIndexes.every((index, i) => i === 0 || index > headerIndexes[i - 1]),
  "desktop history column order: Document, Status, Similarity, AI, Submitted, Actions");

assert(
  row.indexOf('const ai = reportFor(job, "ai")') >= 0 &&
  row.indexOf('job.ai_percentage') < row.indexOf("<HistorySubmittedDate") &&
  row.indexOf("<HistorySubmittedDate") < row.indexOf('title="Delete check"'),
  "Submitted date cell is immediately after AI scores and before action icons");

assert(
  workspace.includes('function HistorySubmittedDate') &&
  workspace.includes('date.toLocaleDateString') &&
  workspace.includes('date.toLocaleTimeString') &&
  workspace.includes('dateTime={value}') &&
  workspace.includes('className="w-full min-w-[900px] table-fixed text-sm"'),
  "date/time formatted on two lines with preserved local time and readable column widths");

assert(
  workspace.includes('function HistoryCard({') &&
  workspace.includes('{formatDate(job.submitted_at || job.created_at)}'),
  "mobile History cards retain their original visible submission date");

console.log(`turnitin-top-actions-history-order: ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
