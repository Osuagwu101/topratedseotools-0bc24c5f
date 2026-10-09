/**
 * Turnitin V2 Phase 2 — dedicated navigation and split workspace.
 * Run: bun tests/turnitin-v2-navigation.test.ts
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

const navbar = readFileSync("src/components/site/Navbar.tsx", "utf8");
const product = readFileSync(
  "src/components/turnitin/TurnitinProductPage.tsx",
  "utf8",
);
const workspace = readFileSync(
  "src/components/turnitin/TurnitinWorkspace.tsx",
  "utf8",
);
const legacyRoute = readFileSync("src/routes/tools.$slug.tsx", "utf8");
const toolsIndex = readFileSync("src/routes/tools.index.tsx", "utf8");
const payments = readFileSync(
  "src/lib/turnitin-credit-payments.functions.ts",
  "utf8",
);
const home = readFileSync("src/routes/index.tsx", "utf8");

const routes = {
  overview: readFileSync("src/routes/turnitin.index.tsx", "utf8"),
  submit: readFileSync("src/routes/turnitin.submit.tsx", "utf8"),
  buy: readFileSync("src/routes/turnitin.buy.tsx", "utf8"),
  history: readFileSync("src/routes/turnitin.history.tsx", "utf8"),
};

assert(
  navbar.includes('{ to: "/turnitin", label: "Turnitin Checks" }'),
  "Turnitin Checks is promoted into the main site navigation",
);

for (const [section, path] of [
  ["overview", "/turnitin/"],
  ["submit", "/turnitin/submit"],
  ["buy", "/turnitin/buy"],
] as const) {
  assert(
    routes[section].includes(`createFileRoute("${path}")`) &&
      routes[section].includes(`section="${section}"`),
    `${section} has its own dedicated Turnitin route`,
  );
}

assert(
  routes.history.includes('createFileRoute("/turnitin/history")') &&
    routes.history.includes('redirect({ to: "/turnitin", replace: true })'),
  "existing History deep links redirect into Overview",
);

for (const tab of [
  'to: "/turnitin"',
  'to: "/turnitin/buy"',
]) {
  assert(
    product.includes(tab) && product.includes("to={tab.to}"),
    `product shell includes navigation tab ${tab}`,
  );
}

assert(
  product.includes("Turnitin Checks sections") &&
    product.includes("Self-service document checking") &&
    !product.includes('to: "/turnitin/submit", label: "Submit File"') &&
    !product.includes('to: "/turnitin/history", label: "History"'),
  "Turnitin top navigation shows only Overview and Buy Checks",
);

assert(
  workspace.includes('view?: TurnitinWorkspaceView') &&
    workspace.includes('view === "overview"') &&
    workspace.includes('view === "submit"') &&
    workspace.includes('view === "buy"') &&
    workspace.includes('view === "history"'),
  "the existing working workspace is split by presentation view instead of duplicated",
);

assert(
  workspace.includes("Submit your first document") &&
    workspace.includes('id="turnitin-check-history"') &&
    workspace.includes('view === "history" || view === "overview"') &&
    product.includes('to: "/turnitin/buy"') &&
    !workspace.includes("Recent checks"),
  "Overview shows compact quick actions and the complete searchable history instead of duplicate recent checks",
);

assert(
  legacyRoute.includes('params.slug === "turnitin"') &&
    legacyRoute.includes('redirect({ to: "/turnitin" })') &&
    !legacyRoute.includes("<TurnitinWorkspace"),
  "the legacy /tools/turnitin route redirects into the dedicated product area",
);

assert(
  payments.includes(
    'const TURNITIN_CALLBACK_URL = "https://topratedseotools.com/turnitin/buy";',
  ),
  "Turnitin payment returns now land on the dedicated Buy Checks page",
);

assert(
  toolsIndex.includes('t.pricingModel === "per_use" && t.perUse') &&
    toolsIndex.includes("money.fmt(t.perUse.amount)"),
  "Browse Tools still exposes Turnitin with its per-check price instead of old WhatsApp pricing",
);

assert(
  home.includes("Turnitin Checks are self-service") &&
    !home.includes("we'll send a payment link"),
  "homepage Turnitin FAQ matches the live self-service flow",
);

for (const forbidden of [
  "turnitin_account_settings",
  "turnitin_postpaid_charges",
  "turnitin_postpaid_settlements",
  "admin grant",
]) {
  assert(
    !product.includes(forbidden) && !workspace.includes(forbidden),
    `Phase 2 does not prematurely implement later-phase billing feature: ${forbidden}`,
  );
}

console.log(`turnitin-v2-navigation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
