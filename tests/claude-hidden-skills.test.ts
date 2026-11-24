import assert from "node:assert/strict";
import { withoutBlockedConnectors, withoutBlockedConnectorEvents, HIDDEN_SKILL_NAMES } from "../src/lib/claude-writer-policy";

const list = {
  plugins: [
    { id: "p1", name: "meta-ads-school-targeting", display_name: { en: "meta-ads-school-targeting" } },
    { id: "p2", name: "academic-stealthwriter" },
    { id: "p3", name: "final-fidelity-check" },
    { id: "p4", name: "academic-god" },
    { id: "p5", name: "deep-research" },
    { id: "p6", name: "google-workspace" },
  ],
};
const out = withoutBlockedConnectors(list);
assert.deepEqual(out.plugins.map((p: any) => p.name), ["deep-research", "google-workspace"]);
for (const n of HIDDEN_SKILL_NAMES) assert.ok(!JSON.stringify(out).includes(n), n);

// Similar names that are not hidden stay visible.
const near = withoutBlockedConnectors({ skills: [{ name: "academic-writing" }, { name: "god-mode-notes" }] });
assert.equal(near.skills.length, 2);

// Event streams are filtered the same way.
const sse = 'event: skills\ndata: {"skills":[{"name":"academic-god"},{"name":"morning"}]}\n\n';
const filtered = withoutBlockedConnectorEvents(sse);
assert.ok(!filtered.includes("academic-god") && filtered.includes("morning"));
console.log("claude-hidden-skills tests passed");
