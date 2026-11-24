import assert from "node:assert/strict";
import { withoutBlockedConnectorEvents } from "../src/lib/claude-writer-policy";

const raw = [
  'event: servers\ndata: {"servers":[{"uuid":"a1b2c3d4-0001","name":"Google Drive"},{"uuid":"a1b2c3d4-0002","name":"GitHub"},{"uuid":"a1b2c3d4-0003","name":"Supabase"},{"uuid":"a1b2c3d4-0004","name":"Notion"}]}',
  'event: single\ndata: {"name":"Supabase","tools":[]}',
  'event: done\ndata: {"ok":true}',
].join("\n\n") + "\n\n";

const out = withoutBlockedConnectorEvents(raw);
assert.ok(!/github|supabase/i.test(out), "blocked providers removed");
assert.ok(out.includes("Google Drive") && out.includes("Notion"), "allowed connectors kept");
assert.ok(out.includes('"ok":true'), "other events kept");
assert.ok(out.includes("event: servers"), "event names kept");
assert.equal(withoutBlockedConnectorEvents(""), "");
console.log("claude-connector-stream tests passed");
