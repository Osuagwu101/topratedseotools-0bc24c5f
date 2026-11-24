import assert from "node:assert/strict";
import {
  CHATGPT_ACCESS_REFERENCES,
  chatGptAccessMessage,
  chatGptAccessNoticeHtml,
  chatGptReferenceForDiagnostic,
} from "../src/lib/chatgpt-access-notice";

const cases: Record<string, string> = {
  session_decrypt_failed: "GPT-01",
  session_cookie_missing: "GPT-01",
  upstream_401: "GPT-01",
  upstream_403_edge_challenge: "GPT-02",
  upstream_403: "GPT-03",
  upstream_network_error: "GPT-04",
  upstream_external_redirect: "GPT-05",
  something_else: "GPT-09",
};
for (const [diag, code] of Object.entries(cases)) {
  assert.equal(chatGptReferenceForDiagnostic(diag), code, diag);
}
for (const code of Object.keys(CHATGPT_ACCESS_REFERENCES) as Array<
  keyof typeof CHATGPT_ACCESS_REFERENCES
>) {
  assert.match(chatGptAccessMessage(code), new RegExp(code));
  assert.match(chatGptAccessMessage(code), /contact Admin/i);
  assert.match(chatGptAccessNoticeHtml(code), new RegExp(`>${code}<`));
  assert.ok(CHATGPT_ACCESS_REFERENCES[code].adminAction.length > 10);
}
console.log("chatgpt-access-notice tests passed");
