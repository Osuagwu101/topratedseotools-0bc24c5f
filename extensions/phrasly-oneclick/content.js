// AWS page-to-worker relay, without account-menu hiding or session access.
// MAIN-world interception and the worker enforce the enabled flag. This isolated
// relay needs no copy of MAIN-world configuration and never wraps native fetch.
window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const message = event.data;
  if (message?.source !== "trst-interceptor" || message.type !== "check" ||
      !["humanizer", "ai_detector"].includes(message.feature) || typeof message.requestId !== "string") return;
  chrome.runtime.sendMessage({ type: "trst_check_usage", feature: message.feature, action_id: message.requestId }, response => {
    window.postMessage({ source: "trst-interceptor-reply", requestId: message.requestId,
      allowed: !chrome.runtime.lastError && response?.allowed === true }, window.location.origin);
  });
});
