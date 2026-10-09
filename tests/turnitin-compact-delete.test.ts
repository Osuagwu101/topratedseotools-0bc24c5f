/** Secure customer deletion and compact Turnitin submission UI. */
import { readFileSync } from "node:fs";
const ui = readFileSync("src/components/turnitin/TurnitinWorkspace.tsx","utf8");
const page = readFileSync("src/components/turnitin/TurnitinProductPage.tsx","utf8");
const functions = readFileSync("src/lib/turnitin.functions.ts","utf8");
const migration = readFileSync("supabase/migrations/20261009104000_turnitin_customer_history_delete.sql","utf8");
let failures=0;
function ok(v:boolean,msg:string){ if(!v){failures++;console.error("FAIL",msg);}else console.log("PASS",msg); }
ok(page.includes('max-w-[520px]') && page.includes('onClick={() => submitButtonRef.current?.click()}') &&
  page.includes('min-h-0 flex-1 overflow-y-auto') && page.includes('border-t bg-background px-5 py-3'),
  "compact modal uses a fixed footer with actionable Submit File button");
ok(page.includes('className="-mb-px flex items-center justify-between gap-3"') &&
  page.includes('tab.section === "buy" && "ml-auto"'),
  "Buy Checks navigates at the right end of the top bar");
ok(ui.includes('<details className="group mt-4') && ui.includes("Advanced Options") &&
  !ui.includes("Similarity exclusions") && ui.includes('checked={excludeBibliography}') &&
  ui.includes('checked={excludeQuotes}'), "Advanced Options hides but preserves four report settings");
ok(ui.includes('setExcludeBibliography] = useState(true)') &&
  ui.includes('setExcludeQuotes] = useState(true)') &&
  ui.includes('setExcludeCitations] = useState(false)') &&
  ui.includes('setExcludeSmallMatches] = useState(false)'),
  "default exclusions still apply when Advanced Options is collapsed");
ok(ui.includes('aria-label="Quick actions"') &&
  ui.includes('<span className="block text-sm font-semibold">Submit file</span>') &&
  !ui.includes('<Link to="/turnitin/buy"'), "only compact Submit File action remains below stat cards");
ok(ui.includes('aria-label={"Delete " + (job.display_name || job.original_filename)}') &&
  (ui.match(/onDelete=\{\(row\)/g)??[]).length === 2 &&
  ui.includes("Delete this check?") && ui.includes("AlertDialogAction"),
  "desktop/mobile history have owner-confirmed red delete action");
ok(functions.includes('deleteMyTurnitinCheck = createServerFn({ method: "POST" })') &&
  functions.includes(".middleware([requireSupabaseAuth])") &&
  functions.includes('.eq("user_id", context.userId)') &&
  functions.includes('.in("status", ["completed", "failed"])') &&
  functions.includes('history_deleted_at: new Date().toISOString()'),
  "authenticated delete is owner-only and finished-check-only");
ok(functions.includes('.is("history_deleted_at", null)') &&
  functions.includes('if (job?.history_deleted_at) throw new Error') &&
  functions.includes('admin.storage') &&
  !functions.includes('.delete().eq("id", data.jobId)'),
  "deleted checks disappear and report downloads stop without erasing billing linkage");
ok(migration.includes("ADD COLUMN IF NOT EXISTS history_deleted_at") &&
  migration.includes("WHERE history_deleted_at IS NULL") &&
  migration.includes("Only trusted server-side actions"),
  "idempotent migration retains credit/postpaid accounting");
console.log(`turnitin-ui-delete: ${9-failures} passed, ${failures} failed`);
if(failures)process.exit(1);
