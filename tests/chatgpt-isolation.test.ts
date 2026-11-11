/**
 * Per-customer ChatGPT history isolation on the shared account.
 * Run: bun tests/chatgpt-isolation.test.ts
 */
import { readFileSync } from "node:fs";
import {
  buildOwnedConversationPage,
  conversationIdFromApiPath,
  conversationIdFromBody,
  conversationIdFromDocumentPath,
  conversationIdFromStreamText,
  deepFilterConversations,
  filterServerRenderedHistory,
  hiddenAccountSurface,
  isBlockedConversationMutation,
  isConversationListPath,
} from "../src/lib/chatgpt-isolation.server";
import { isBlockedChatGptApiRequest } from "../src/lib/chatgpt-controls.server";

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

const A = "6af45cc7-f938-83ea-85f5-8baab136676a";
const B = "6aef0ab3-0a8c-83ea-84ed-7a4b46371a04";
const C = "6aedaec9-9e8c-83ea-9385-08672dcb4fe5";
const owned = new Set([A]);

// ---- path / body parsing
assert(conversationIdFromApiPath(`/backend-api/conversation/${A}`) === A, "reads id from /conversation/<id>");
assert(conversationIdFromApiPath(`/backend-api/conversations/${A}/textdocs`) === A, "reads id from /conversations/<id>/...");
assert(conversationIdFromApiPath(`/backend-api/f/conversation/${A}/stream_status`) === A, "reads id from /f/conversation/<id>/...");
assert(conversationIdFromApiPath("/backend-api/conversations") === null, "list path addresses no conversation");
assert(conversationIdFromDocumentPath(`/c/${A}`) === A && conversationIdFromDocumentPath(`/g/g-abc/c/${A}`) === A, "reads id from /c/<id> pages");
assert(conversationIdFromBody(`{"action":"next","conversation_id":"${A}"}`) === A, "reads conversation_id from request bodies");
assert(conversationIdFromBody(`{"action":"next","conversation_id":null}`) === null, "new chats carry no id");
assert(conversationIdFromStreamText(`data: {"type":"resume_conversation_token","conversation_id": "${A}"}`) === A, "finds the new id in the stream");
assert(isConversationListPath("/backend-api/conversations") && !isConversationListPath("/backend-api/conversations/search"), "detects the history list endpoint");

// ---- delete / archive blocks
assert(isBlockedConversationMutation("PATCH", `/backend-api/conversation/${A}`, '{"is_visible":false}'), "blocks deleting a chat");
assert(isBlockedConversationMutation("PATCH", `/backend-api/conversation/${A}`, '{"is_archived": true}'), "blocks archiving a chat");
assert(isBlockedConversationMutation("PATCH", "/backend-api/conversations", '{"is_visible":false}'), "blocks delete-all");
assert(isBlockedConversationMutation("DELETE", `/backend-api/conversations/${A}`, null), "blocks DELETE on a chat");
assert(!isBlockedConversationMutation("PATCH", `/backend-api/conversation/${A}`, '{"title":"New name"}'), "renaming stays allowed");
assert(!isBlockedConversationMutation("POST", "/backend-api/f/conversation", '{"action":"next"}'), "sending messages stays allowed");

// ---- account-wide blocks
assert(isBlockedChatGptApiRequest("POST", "/api/auth/signout"), "blocks signing the shared account out");
assert(isBlockedChatGptApiRequest("POST", "/backend-api/accounts/logout_all"), "blocks log-out-everywhere");
assert(isBlockedChatGptApiRequest("PATCH", "/backend-api/settings/user"), "blocks settings changes");
assert(isBlockedChatGptApiRequest("POST", "/backend-api/payments/customer_portal"), "blocks billing");
assert(!isBlockedChatGptApiRequest("GET", "/backend-api/settings/user"), "reading settings still works");
assert(!isBlockedChatGptApiRequest("POST", "/backend-api/f/conversation"), "chatting is not blocked");
assert(JSON.stringify(hiddenAccountSurface("GET", "/backend-api/memories")).includes('"memories":[]'), "hides shared memories");
assert(hiddenAccountSurface("GET", "/backend-api/my/recent/image_gen") !== null, "hides the shared image library");
assert(hiddenAccountSurface("GET", "/backend-api/automations") !== null, "hides shared scheduled tasks");

// ---- JSON filtering
const conv = (id: string, title: string) => ({ id, title, create_time: "2026-11-11", update_time: "2026-11-11" });
const list = deepFilterConversations({ items: [conv(A, "Mine"), conv(B, "Theirs")], total: 2 }, owned);
assert(list.items.length === 1 && list.items[0].title === "Mine", "history list keeps only the writer's chats");
const search = deepFilterConversations({ items: [{ conversation_id: B, title: "Theirs", update_time: 1 }, { conversation_id: A, title: "Mine", update_time: 1 }] }, owned);
assert(search.items.length === 1 && search.items[0].conversation_id === A, "search keeps only the writer's chats");
const pins = deepFilterConversations([{ item_type: "conversation", item: conv(B, "Theirs") }, { item_type: "conversation", item: conv(A, "Mine") }], owned);
assert(pins.length === 1 && pins[0].item.id === A, "pins keep only the writer's chats");
const projects = deepFilterConversations({ items: [{ gizmo: { id: "g-p" }, conversations: { items: [conv(B, "T"), conv(A, "M")] } }] }, owned);
assert(projects.items[0].conversations.items.length === 1, "project chat lists are filtered too");
const page = buildOwnedConversationPage([{ items: [conv(B, "x"), conv(A, "y")], total: 2 }], owned, 0, 28);
assert(page.items.length === 1 && page.total === 1, "builds a page of only owned chats");
assert(buildOwnedConversationPage([], new Set(), 0, 28).items.length === 0, "writers with no chats get an empty history");

// ---- server-rendered sidebar (React Router turbo-stream)
const line1 = JSON.stringify([
  { _1: 2 }, "loaderData", { _3: 4 }, "items", [5, 6],
  { _7: 8, _9: 10, _11: 12 }, { _7: 13, _9: 14, _11: 12 },
  "id", A, "title", "Mine", "create_time", "2026-11-11", B, "Theirs secret",
]);
const line2 = "P2:" + JSON.stringify([[16], { _7: 17, _9: 18, _11: 12 }, C, "Other secret"]);
const html =
  `<html><script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(line1 + "\n")});</script>` +
  `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(line2 + "\n")});</script></html>`;
const filtered = filterServerRenderedHistory(html, owned);
assert(filtered.includes("Mine") && filtered.includes(A), "server-rendered sidebar keeps the writer's chats");
assert(!filtered.includes("Theirs secret") && !filtered.includes(B), "foreign titles and ids are removed from the page");
assert(!filtered.includes("Other secret") && !filtered.includes(C), "later stream chunks are filtered too");
{
  const m = filtered.match(/enqueue\(("(?:[^"\\]|\\.)*")\)/);
  const first = JSON.parse(JSON.parse(m![1]).split("\n")[0]);
  assert(JSON.stringify(first[4]) === "[5]", "foreign entries are dropped from the list array");
}
assert(filterServerRenderedHistory("<html>no data</html>", owned) === "<html>no data</html>", "pages without history are untouched");
{
  const xss = JSON.stringify([
    { _1: 2 }, "items", [3, 10],
    { _4: 5, _6: 7, _8: 9 }, "id", A, "title", "</script><b>x", "create_time", "t",
    { _4: 11, _6: 12, _8: 9 }, B, "theirs",
  ]);
  const input = `<script>a.streamController.enqueue(${JSON.stringify(xss).replace(/</g, "\\u003c")});</script>`;
  const out = filterServerRenderedHistory(input, owned);
  assert(!out.includes("theirs"), "foreign chat removed in escape test");
  assert(!out.includes("</script><b>"), "re-encoded payloads never break out of the script tag");
}

// ---- wiring
const proxy = readFileSync("src/lib/chatgpt-proxy.server.ts", "utf8");
assert(
  proxy.includes("isBlockedChatGptApiRequest(request.method, target.pathname)") &&
    proxy.includes("isBlockedConversationMutation(request.method, target.pathname, bodyText)") &&
    proxy.includes("filterServerRenderedHistory(rewritten, ownedIds)") &&
    proxy.includes("teeConversationOwnership(upstream.body, writerId)") &&
    proxy.includes("owner !== writerId"),
  "proxy enforces account blocks, delete/archive blocks and per-writer history",
);
const migration = readFileSync("supabase/migrations/20261111220000_chatgpt_conversation_owners.sql", "utf8");
assert(
  migration.includes("chatgpt_conversation_owners") &&
    migration.includes("enable row level security") &&
    migration.includes("revoke all on table public.chatgpt_conversation_owners from authenticated"),
  "ownership table is server-only",
);

console.log(`chatgpt-isolation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
