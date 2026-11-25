/**
 * Claude OneClick plugins/connectors must keep working while GitHub,
 * Supabase and admin-only skills stay blocked.
 *
 * Regression (Nov 2026): the filter matched the word "github" anywhere in the
 * JSON. The official plugin marketplace is hosted on github.com, so the whole
 * plugin store vanished and its id was blocklisted for every later request.
 * Run: bun tests/claude-plugins-regression.test.ts
 */
import assert from "node:assert/strict";
import {
  blockedConnectorIds,
  claudeWriterReferences,
  isBlockedEntry,
  requestUsesBlockedConnector,
  withoutBlockedConnectorEvents,
  withoutBlockedConnectors,
} from "../src/lib/claude-writer-policy";

// 1. Marketplaces and plugins hosted on GitHub stay visible.
const store = withoutBlockedConnectors({
  marketplaces: [
    {
      id: "mkt_official01",
      name: "claude-plugins-official",
      source: { type: "github", repo: "anthropics/claude-plugins-official", url: "https://github.com/anthropics/claude-plugins-official" },
      plugins: [
        { id: "plg_docx0001", name: "docx", homepage: "https://github.com/anthropics/skills", description: "Word files. Source on GitHub." },
        { id: "plg_seo00001", name: "seo-audit" },
      ],
    },
  ],
});
assert.equal(store.marketplaces.length, 1, "official marketplace kept");
assert.equal(store.marketplaces[0].plugins.length, 2, "plugins hosted on GitHub kept");
assert.equal(blockedConnectorIds.size, 0, "nothing blocklisted for a GitHub-hosted marketplace");

// 2. Connectors whose description mentions GitHub stay; the GitHub and Supabase connectors go.
const connectors = withoutBlockedConnectors({
  connectors: [
    { uuid: "conn_canva001", name: "Canva", description: "Publish to GitHub Pages" },
    { uuid: "conn_github01", name: "GitHub" },
    { uuid: "conn_supa0001", display_name: "Supabase" },
    { uuid: "conn_mcp00001", name: "Code tools", url: "https://api.githubcopilot.com/mcp/" },
    { uuid: "conn_drive001", name: "Google Drive" },
  ],
});
assert.deepEqual(connectors.connectors.map((c: any) => c.name ?? c.display_name), ["Canva", "Google Drive"]);
assert.ok(blockedConnectorIds.has("conn_github01") && blockedConnectorIds.has("conn_supa0001") && blockedConnectorIds.has("conn_mcp00001"));
assert.ok(!blockedConnectorIds.has("conn_canva001"), "Canva not blocklisted");

// 3. Requests: installing/using a GitHub-hosted plugin is allowed; the blocked connectors are refused.
assert.equal(requestUsesBlockedConnector({ marketplace_id: "mkt_official01", plugin: "docx", source: "https://github.com/anthropics/skills" }), false);
assert.equal(requestUsesBlockedConnector({ enabled: true, connector_id: "conn_canva001", note: "sync from github" }), false);
assert.equal(requestUsesBlockedConnector({ connector_id: "conn_github01" }), true);
assert.equal(requestUsesBlockedConnector({ server: { name: "Supabase" } }), true);
assert.equal(requestUsesBlockedConnector({ skill: "anthropic-skills:academic-god" }), true);

// 4. Admin-only skills are removed one by one; the plugin that holds them stays.
const skills = withoutBlockedConnectors({
  plugins: [
    { id: "plg_user0001", name: "anthropic-skills", skills: [{ name: "academic-god" }, { name: "docx" }, { name: "anthropic-skills:final-fidelity-check" }] },
  ],
});
assert.equal(skills.plugins.length, 1, "user skills plugin kept");
assert.deepEqual(skills.plugins[0].skills.map((s: any) => s.name), ["docx"]);

// 5. Event streams: a connector event mentioning GitHub in a description survives.
const sse = withoutBlockedConnectorEvents('event: connectors\ndata: {"items":[{"name":"Notion","description":"Sync docs from GitHub"},{"name":"GitHub"}]}\n\n');
assert.ok(sse.includes("Notion") && !sse.includes('"name":"GitHub"'));

// 6. Sending a message with connector tools whose schemas mention GitHub is fine.
const refs = claudeWriterReferences({
  prompt: "hi",
  tools: [{ name: "notion_search", description: "Search Notion (also GitHub-synced pages)", input_schema: { properties: { fileId: { type: "string" } } } }],
});
assert.equal(refs.blocked, null);

assert.equal(isBlockedEntry({ name: "github-pages-helper" }), true, "names containing github are still blocked");
console.log("claude-plugins-regression tests passed");
