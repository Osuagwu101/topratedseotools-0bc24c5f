import { readFileSync } from "node:fs";
import {
  DEFAULT_TURNITIN_REPORT_PREFERENCES as defaults,
  turnitinReportPreferencesSchema,
  reportDownloadFilename,
  prefsToRow,
  prefsFromRow,
} from "../src/lib/turnitin-report-preferences";

let passed = 0;
let failed = 0;
function check(assertion: boolean, name: string) {
  if (!assertion) { failed++; console.error("FAIL", name); }
  else { passed++; console.log("PASS", name); }
}
check(defaults.compareInternet && defaults.comparePublications && defaults.compareSubmittedWorks,
  "Originality comparison collections initially enabled");
check(defaults.excludeBibliography && defaults.excludeQuotes && !defaults.excludeCitations && !defaults.excludeSmallMatches,
  "previous Turnitin exclusions preserved as defaults");
check(defaults.reportView === "sources" && defaults.aiReportPrefix === "AI_" && defaults.similarityReportPrefix === "SI_",
  "report view preserved and default similarity prefix capitalized");
check(turnitinReportPreferencesSchema.safeParse(defaults).success,"defaults validate");
check(!turnitinReportPreferencesSchema.safeParse({...defaults, compareInternet:false, comparePublications:false, compareSubmittedWorks:false}).success,
  "at least one comparison collection required");
check(!turnitinReportPreferencesSchema.safeParse({...defaults, aiReportPrefix: "bad/"}).success &&
      !turnitinReportPreferencesSchema.safeParse({...defaults, similarityReportPrefix: "bad\\name"}).success,
  "unsafe prefixes rejected");
check(!turnitinReportPreferencesSchema.safeParse({...defaults, smallMatchMode: "words", smallMatchThreshold: 2}).success,
  "threshold validation prevents unsupported exclusion ranges");
check(prefsFromRow(prefsToRow(defaults)).reportView === "sources", "database roundtrip maps defaults");
check(reportDownloadFilename("Example.docx", "ai", defaults) === "AI_Example.pdf" &&
      reportDownloadFilename("Example.docx", "similarity", defaults) === "SI_Example.pdf",
  "default AI_/SI_ prefixes appear on downloads");
check(reportDownloadFilename("Essay.docx","ai",{ ...defaults,useFilenamePrefixes:false}) === "Essay.pdf",
  "original filename mode works");
check(reportDownloadFilename("Folder/Chapter.ONE.docx", "ai", { ...defaults, aiReportPrefix: "Custom_"}) === "Custom_Chapter.ONE.pdf",
  "custom prefix removes original extension and path");
const ws=readFileSync("src/components/turnitin/TurnitinWorkspace.tsx","utf8");
const api=readFileSync("src/lib/turnitin-report-preferences.functions.ts","utf8");
const ui=readFileSync("src/components/turnitin/TurnitinReportSettingsButton.tsx","utf8");
const download=readFileSync("src/lib/turnitin.functions.ts","utf8");
const migration=readFileSync("supabase/migrations/20261009145000_turnitin_report_preferences.sql","utf8");
const newDefaultMigration=readFileSync("supabase/migrations/20261009151000_turnitin_similarity_prefix_uppercase.sql","utf8");
check(ws.includes("<TurnitinReportSettingsButton") && ws.includes('placeholder="Search document name"'),
  "report settings appear in History toolbar");
check(ws.includes('enabled: isAuthenticated && (view === "submit" || view === "all")') &&
  ws.includes("setExcludeBibliography(p.excludeBibliography)") &&
  ws.includes("setReportView(p.reportView)"),"saved exclusions and report view are loaded for new uploads");
check(ui.includes("Compare submissions with") && ui.includes("Exclude from Similarity Report") &&
      ui.includes("Default report view") && ui.includes("Downloaded report file names") &&
      ui.includes("Save settings") && ui.includes("Reset"),"four reference sections with save and reset");
check(ui.includes("does not change its active upstream source databases"),
  "provider database limits disclosed rather than misrepresented");
check(api.includes(".middleware([requireSupabaseAuth])") &&
  api.includes("user_id: context.userId") &&
  api.includes('.eq("user_id", context.userId)') &&
  api.includes('onConflict: "user_id"'),
  "server saves and resets only authenticated user's preferences");
check(download.includes("reportDownloadFilename(") && download.includes('.from("turnitin_report_preferences")') &&
  download.includes('.eq("user_id", context.userId)'),"download applies current user prefix settings");
check(migration.includes("ENABLE ROW LEVEL SECURITY") && migration.includes("FOR SELECT TO authenticated") &&
  migration.includes("PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE"),
  "preferences have per-user RLS and no client write policy");
check(newDefaultMigration.includes("ALTER COLUMN similarity_report_prefix SET DEFAULT 'SI_'") &&
  !newDefaultMigration.includes("UPDATE public.turnitin_report_preferences"),
  "database default is SI_ without overwriting customers' saved naming preferences");
console.log(`turnitin-report-preferences: ${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
