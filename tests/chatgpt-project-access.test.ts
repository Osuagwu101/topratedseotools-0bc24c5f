/**
 * Shared ChatGPT projects granted to one writer.
 * Run: bun tests/chatgpt-project-access.test.ts
 */
import {
  applyProjectAccess,
  createdProjectId,
  buildProjectAccess,
  projectIdFromInput,
  projectOfConversationListPath,
  touchesHiddenProject,
} from "../src/lib/chatgpt-project-access";
import { deepFilterConversations, filterServerRenderedHistory } from "../src/lib/chatgpt-isolation.server";

let passed = 0, failed = 0;
const assert = (c: boolean, m: string) => { if (c) passed++; else { failed++; console.error("  ✗", m); } };

const P1 = "g-p-" + "a".repeat(32);
const P2 = "g-p-" + "b".repeat(32);
const C1 = "11111111-1111-4111-8111-111111111111"; // collaborator chat in P1
const C2 = "22222222-2222-4222-8222-222222222222"; // writer's own chat
const C3 = "33333333-3333-4333-8333-333333333333"; // chat in P2
const conv = (id: string, extra: object = {}) => ({ id, title: "t" + id.slice(0, 2), create_time: 1, ...extra });

assert(projectIdFromInput(`https://chatgpt.com/g/${P1}-thesis/project`) === P1, "reads project id from link");
assert(projectIdFromInput("nothing here") === null, "rejects text without project id");
assert(projectOfConversationListPath(`/backend-api/gizmos/${P1}/conversations`) === P1, "project chat list path");
assert(projectOfConversationListPath(`/backend-api/gizmos/${P1}`) === null, "project detail is not a chat list");

const grants = [{ project_id: P1, user_id: "grantee" }];
const grantee = buildProjectAccess(grants, "grantee");
const other = buildProjectAccess(grants, "other");
assert(grantee.granted.has(P1) && !grantee.hidden.has(P1), "grantee has project");
assert(other.hidden.has(P1) && !other.granted.size, "other writer has it hidden");

assert(touchesHiddenProject(other, `/g/${P1}-thesis/project`, null), "page of hidden project blocked");
assert(touchesHiddenProject(other, "/backend-api/f/conversation", `{"gizmo_id":"${P1}"}`), "posting into hidden project blocked");
assert(touchesHiddenProject(other, `/g/${P2}-x/project`, null), "unassigned upstream project blocked");
assert(!touchesHiddenProject(grantee, `/g/${P1}-thesis/project`, null), "grantee may open project");

// Project sidebar: [{gizmo:{gizmo:{id}}, conversations:{items:[…]}}]
const sidebar = {
  items: [
    { gizmo: { gizmo: { id: P1, display: { name: "Thesis" } } }, conversations: { items: [conv(C1)] } },
    { gizmo: { gizmo: { id: P2, display: { name: "Other" } } }, conversations: { items: [conv(C3, { gizmo_id: P2 })] } },
  ],
  cursor: null,
};
{
  const r = applyProjectAccess(sidebar, other);
  assert(r.payload.items.length === 0, "writer without access sees no upstream projects");
  assert(r.grantedConversations.size === 0, "other writer gains nothing");
}
{
  const r = applyProjectAccess(sidebar, grantee);
  assert(r.payload.items.length === 1, "grantee keeps only the permitted project");
  assert(r.grantedConversations.get(C1) === P1, "collaborator chat inside granted project found");
  assert(!r.grantedConversations.has(C3), "chat in other project not granted");
  const owned = new Set([C2, ...r.grantedConversations.keys()]);
  const filtered = deepFilterConversations(r.payload, owned);
  assert(filtered.items[0].conversations.items.length === 1, "grantee sees collaborator chat");
  assert(filtered.items.length === 1, "grantee does not see other projects or their chats");
}
{
  const list = { items: [conv(C1)], cursor: null };
  const r = applyProjectAccess(list, grantee, P1);
  assert(r.grantedConversations.get(C1) === P1, "project chat list attributes chats to its project");
  const none = applyProjectAccess({ items: [conv(C2)] }, grantee, null);
  assert(none.grantedConversations.size === 0, "main history chats never attributed to a project");
}
{
  const history = { items: [conv(C2), conv(C1, { gizmo_id: P1 })] };
  const r = applyProjectAccess(history, other);
  assert(r.payload.items.length === 1 && r.payload.items[0].id === C2, "chat inside hidden project dropped for other writer");
}

// Server-rendered sidebar (turbo-stream)
const sse = (values: any[]) => `<script>streamController.enqueue(${JSON.stringify(JSON.stringify(values))})</script>`;
// indexes: 0 list, 1 projectObj, 2 "id", 3 P1, 4 "title", 5 "Thesis", 6 convObj, 7 C1, 8 "create_time", 9 1, 10 "gizmo_id"
const values = [[1, 6], { _2: 3, _4: 5 }, "id", P1, "title", "Thesis", { _2: 7, _4: 5, _8: 9, _10: 3 }, C1, "create_time", 1, "gizmo_id"];
{
  const html = filterServerRenderedHistory(sse(values), new Set(), other);
  assert(!html.includes(P1) || !html.includes("Thesis"), "SSR: hidden project title blanked for other writer");
  assert(html.includes("[]"), "SSR: hidden project entries removed from list");
}
{
  const found = new Map<string, string>();
  const html = filterServerRenderedHistory(sse(values), new Set(), grantee, found);
  assert(html.includes(C1), "SSR: grantee keeps collaborator chat");
  assert(found.get(C1) === P1, "SSR: grantee chat recorded");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

const empty = buildProjectAccess([], "new-writer");
assert(applyProjectAccess(sidebar, empty).payload.items.length === 0, "empty grants fail closed for all projects");
assert(touchesHiddenProject(empty, `/g/${P1}/project`, null), "untracked project direct link denied");
assert(touchesHiddenProject(empty, "/backend-api/f/conversation", JSON.stringify({gizmo_id:P1})), "untracked project conversation denied");
assert(touchesHiddenProject(empty, "/backend-api/f/conversation", '{"gizmo_id":"\\u0067-p-'+'a'.repeat(32)+'"}'), "JSON escaped project ID denied");
assert(!touchesHiddenProject(empty, "/backend-api/f/conversation", '{"prompt":"hello"}'), "ordinary new chat unaffected");
assert(!filterServerRenderedHistory(sse(values), new Set(), empty).includes("Thesis"), "SSR unassigned upstream titles removed");
assert(createdProjectId("POST", "/backend-api/gizmos", {gizmo:{gizmo:{id:P1}}})===P1, "provider project creation response recognised");
assert(createdProjectId("GET", "/backend-api/gizmos", {gizmo:{id:P1}})===null, "listing cannot claim ownership");
assert(createdProjectId("POST", `/backend-api/gizmos/${P1}/share`, {id:P1})===null, "editing or joining existing project cannot claim ownership");
assert(createdProjectId("POST", "/backend-api/gizmos", {id:"g-custom-gpt"})===null, "custom GPT is not a project");
if (failed) process.exit(1);

const bootstrap = '<script type="application/json">'+JSON.stringify(sidebar)+'</script>';
assert(!filterServerRenderedHistory(bootstrap,new Set(),empty).includes(P1), "JSON bootstrap hides unknown projects");
assert(!filterServerRenderedHistory('<a href="/g/'+P2+'/project"><span>Private upstream</span></a>',new Set(),grantee).includes("Private upstream"), "rendered foreign project links removed");
const nested = [[1],{_2:3,_4:5},"id",P2,"display",{_6:7},"name","Nested private title"];
assert(!filterServerRenderedHistory(sse(nested),new Set(),empty).includes("Nested private title"),"SSR nested project display metadata scrubbed");
console.log(`Final project checks: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
