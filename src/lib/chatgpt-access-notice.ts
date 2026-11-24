/**
 * Reference codes for ChatGPT proxy failures. Every failure that used to show
 * one generic "temporarily unavailable" message now carries a short code, so a
 * customer can quote it and the admin knows what to do (same idea as SW-07 on
 * the StealthWriter proxy).
 */
export type ChatGptAccessReference =
  | "GPT-01"
  | "GPT-02"
  | "GPT-03"
  | "GPT-04"
  | "GPT-05"
  | "GPT-09";

export const CHATGPT_ACCESS_REFERENCES: Record<
  ChatGptAccessReference,
  { adminAction: string }
> = {
  // Saved ChatGPT login is missing, unreadable, or ChatGPT rejected it (401).
  "GPT-01": {
    adminAction: "Refresh the ChatGPT session in the admin panel.",
  },
  // ChatGPT's bot-check blocked the server.
  "GPT-02": {
    adminAction:
      "ChatGPT showed a security check. Refresh the session; if it repeats, wait and retry.",
  },
  // ChatGPT refused this one request (403) but is otherwise reachable.
  "GPT-03": {
    adminAction:
      "ChatGPT refused one request. Usually harmless if the rest works; refresh the session only if everything fails.",
  },
  // The server could not reach ChatGPT at all.
  "GPT-04": {
    adminAction: "Check the server's internet connection and ChatGPT's status.",
  },
  // ChatGPT redirected somewhere outside its own site.
  "GPT-05": {
    adminAction: "Refresh the session; ChatGPT asked for an unexpected login.",
  },
  // Anything else inside the proxy.
  "GPT-09": {
    adminAction: "Check the ChatGPT proxy logs on the server.",
  },
};

export const CHATGPT_ACCESS_NOTICE_HEADER = "X-TRST-Access-Reference";

export function chatGptAccessMessage(code: ChatGptAccessReference) {
  return `ChatGPT is temporarily unavailable. Please contact Admin and mention reference ${code}. Your subscription remains active.`;
}

export function chatGptAccessNoticeHtml(code: ChatGptAccessReference) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ChatGPT Access Needs Attention</title></head><body style="margin:0;background:#f6f8fc;color:#172b4d;font-family:system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh;display:grid;place-items:center"><main style="max-width:510px;margin:24px;padding:32px;background:white;border:1px solid #e1e7f0;border-radius:16px;box-shadow:0 14px 35px #172b4d12;text-align:center"><h1 style="font-size:24px;margin:0 0 16px;color:#1e4e8c">ChatGPT Access Needs Attention</h1><p style="line-height:1.7">ChatGPT is temporarily unavailable through your dashboard.</p><p style="line-height:1.7">Please contact Admin on WhatsApp for a quick access refresh. Your subscription remains active.</p><section style="background:#f1f3f9;border-radius:12px;padding:19px;margin-top:22px"><div style="font-size:12px;font-weight:700;letter-spacing:.08em">PLEASE MENTION THIS REFERENCE</div><div style="font-size:48px;font-weight:900;letter-spacing:.05em;color:#332580;margin:8px 0">${code}</div><div style="font-size:13px">Include this code when contacting Admin.</div></section></main></body></html>`;
}

/** Map the proxy's internal diagnostic names to the customer-facing codes. */
export function chatGptReferenceForDiagnostic(
  diagnostic: string,
): ChatGptAccessReference {
  switch (diagnostic) {
    case "session_decrypt_failed":
    case "session_cookie_missing":
    case "upstream_401":
      return "GPT-01";
    case "upstream_403_edge_challenge":
      return "GPT-02";
    case "upstream_403":
      return "GPT-03";
    case "upstream_network_error":
      return "GPT-04";
    case "upstream_external_redirect":
      return "GPT-05";
    default:
      return "GPT-09";
  }
}
