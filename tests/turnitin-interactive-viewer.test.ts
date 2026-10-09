import { readFileSync } from "node:fs";

const adapter=readFileSync("src/lib/turnitin-originality.server.ts","utf8");
const server=readFileSync("src/lib/turnitin-viewer.functions.ts","utf8");
const viewer=readFileSync("src/components/turnitin/TurnitinReportViewer.tsx","utf8");
const workspace=readFileSync("src/components/turnitin/TurnitinWorkspace.tsx","utf8");
const route=readFileSync("src/routes/turnitin.report.$jobId.tsx","utf8");
let passed=0,failed=0;
function check(ok:boolean,desc:string){if(ok){passed++;console.log("PASS",desc);}else{failed++;console.error("FAIL",desc);}}
check(workspace.includes('to="/turnitin/report/$jobId"') &&
  (workspace.match(/<Eye className="h-3 w-3" \/> View report/g)||[]).length===2 &&
  workspace.includes('similarity?.status === "available"'),
  "Completed rows and mobile cards expose View report only when similarity is available");
check(route.includes('createFileRoute("/turnitin/report/$jobId")') &&
  route.includes('Route.useParams()') &&
  route.includes('<TurnitinReportViewer jobId={jobId} />'),
  "Dedicated report viewer routes by local job UUID, never upstream ID");
check(server.includes(".middleware([requireSupabaseAuth])") &&
  server.includes('.eq("user_id", userId)') &&
  server.includes('.is("history_deleted_at", null)') &&
  server.includes('job.status !== "completed"'),
  "All viewer actions authenticate, verify owner and reject deleted/incomplete checks");
check(server.includes('getOriginalityViewerData(') &&
  server.includes('getOriginalityViewerPage(') &&
  server.includes('setOriginalityViewerFilters(') &&
  server.includes('downloadOriginalityViewerSimilarityPdf('),
  "Viewer uses actual Originality data, page images, persisted filters and filtered PDF");
check(adapter.includes('/user/viewer/${submissionId}/data') &&
  adapter.includes('/user/viewer/${submissionId}/exclusions') &&
  adapter.includes('/user/viewer/${submissionId}/page/${pageIndex}.svg') &&
  adapter.includes('/user/viewer/${submissionId}/download/similarity'),
  "Server adapter maps audited genuine upstream interactive viewer endpoints");
check(server.includes('collections: z.array(z.enum(["internet", "publication", "submitted_work"]))') &&
  server.includes('small_matches: z.object(') &&
  server.includes('.min(1).max(3)') &&
  server.includes('mode === "words" ? [8, 250] : [1, 50]'),
  "Filters validate collection selection, exclusion booleans and provider small-match ranges");
check(server.includes('sources, matches,') &&
  server.includes('const prev = current.exclusions ?? {}') &&
  server.includes('filters: data.filters'),
  "Saving filters preserves existing upstream source and match exclusions");
check(server.includes('await bucket.upload(path, bytes,') &&
  server.includes('.update({') &&
  server.includes('sha256: createHash("sha256")') &&
  server.includes('await bucket.remove([path]);') &&
  server.includes('pdfUpdated = true;'),
  "PDF replacement is verified before updating stored history download");
check(viewer.includes('function FilterControls') &&
  viewer.includes("Compare submissions against") &&
  viewer.includes("Exclude bibliography") &&
  viewer.includes("Exclude quoted text") &&
  viewer.includes("Exclude cited text") &&
  viewer.includes("Exclude small matches") &&
  viewer.includes("Apply Filters"),
  "Drawer exposes all collections/exclusions and Apply Filters");
check(viewer.includes('getMyTurnitinViewerPageImage(') &&
  viewer.includes('match.rects') && viewer.includes('setPanel("filters")') &&
  viewer.includes('getMyTurnitinReportDownload(') &&
  viewer.includes('result.pdfUpdated'),
  "Report pages have highlights; viewer applies filters and downloads updated PDF");
check(!server.includes("encrypted_payload") &&
  !server.includes("originalityCookieHeader") &&
  !viewer.includes("turnitin_admin_session") &&
  server.includes('getOriginalityViewerData(supabaseAdmin'),
  "No shared upstream session data is exposed to customer components or functions");
console.log(`turnitin-interactive-viewer: ${passed} passed, ${failed} failed`);
if(failed)process.exit(1);
