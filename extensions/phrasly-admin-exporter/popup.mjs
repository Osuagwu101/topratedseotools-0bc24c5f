import {validateCookies} from "./core.mjs";
const list = document.getElementById("cookie-list"), copy = document.getElementById("copy-json-btn"), send = document.getElementById("send-admin-btn");
const status = document.getElementById("status-message"), count = document.getElementById("cookie-count"), session = document.getElementById("session-status");
let cookies = [], tabId;
const messages = {phrasly_page_required: "Open a signed-in phrasly.ai tab, then open this extension again.", phrasly_sign_in_required: "Sign in to Phrasly before sending its session.", cookie_store_unavailable: "This browser's Phrasly cookies could not be read.", invalid_cookie_bundle: "The Phrasly cookie export is empty or too large.", extension_request_failed: "The request could not be completed. Open the extension and try again."};
async function request(type) { const result = await chrome.runtime.sendMessage({type, tabId}); if (!result?.ok) throw new Error(result?.error || "extension_request_failed"); return result; }
async function load() {
  try {
    const [tab] = await chrome.tabs.query({active: true, currentWindow: true}); tabId = tab?.id;
    const result = await request("GET_PHRASLY_COOKIES"); cookies = validateCookies(result.cookies, false);
    count.textContent = cookies.length + " Phrasly cookies";
    const signedIn = cookies.some(c => c.name === "session" && c.value);
    session.textContent = signedIn ? "Session found" : "Sign in needed";
    for (const cookie of cookies) { const item = document.createElement("li"); const name=document.createElement("span");name.className="cookie-name";name.textContent=cookie.name;const value=document.createElement("span");value.className="cookie-value";value.textContent="•••••••• (value hidden)";item.append(name,value); list.appendChild(item); }
    copy.disabled = false; send.disabled = !signedIn;
  } catch (e) { count.textContent = "Phrasly account required"; status.textContent = messages[e.message] || messages.extension_request_failed; }
}
copy.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(JSON.stringify(cookies, null, 2)); status.textContent = "Complete cookie JSON copied."; }
  catch { status.textContent = "Copy failed. Keep the popup in focus and try again."; }
});
send.addEventListener("click", async () => {
  copy.disabled = true; send.disabled = true; status.textContent = "Opening TopRated Admin…";
  try { await request("SEND_PHRASLY_COOKIES"); status.textContent = "Sent. Sign in to Admin, choose the account and save."; }
  catch (e) { status.textContent = messages[e.message] || messages.extension_request_failed; copy.disabled = false; send.disabled = false; }
});
void load();
