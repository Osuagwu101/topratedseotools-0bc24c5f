// Runs inside phrasly.ai pages (see manifest.json's content_scripts). Hides
// the account dropdown menu (Settings / Billing / Affiliate / Log out /
// Upgrade Plan etc.) the instant it appears, so a buyer never sees or can
// click into account-management options — on top of ext-fulfill.php/
// background.js's webNavigation block, which stops direct navigation to
// those pages even if this heuristic ever misses.
//
// Deliberately text-based rather than a hardcoded CSS selector: a specific
// class/id would silently stop working the moment Phrasly ships a frontend
// rebuild (common with hashed React/Next.js class names), with no way for
// us to notice. Matching on the menu's own visible text is far more durable
// — it only breaks if Phrasly renames the menu items themselves.

const SENSITIVE_LABELS = ['settings', 'billing', 'affiliate', 'log out', 'logout', 'upgrade plan'];
const MAX_CANDIDATE_CHILDREN = 40; // refuse to hide anything this large — a real menu panel is small; a page shell is not

function matchCount(text) {
  return SENSITIVE_LABELS.filter((label) => text.includes(label)).length;
}

// Finds and hides the SMALLEST element that contains 2+ sensitive labels,
// checking children before the parent — so a big wrapper that merely
// contains the real menu somewhere inside it is never the one that gets
// hidden; only the tight menu panel itself is.
function hideSmallestMatch(el) {
  if (el.nodeType !== Node.ELEMENT_NODE) return false;

  let childHid = false;
  for (const child of el.children) {
    if (hideSmallestMatch(child)) childHid = true;
  }
  if (childHid) return true; // a descendant already handled it — don't also grab this ancestor

  const text = (el.textContent || '').toLowerCase();
  if (matchCount(text) >= 2 && el.querySelectorAll('*').length <= MAX_CANDIDATE_CHILDREN) {
    el.style.setProperty('display', 'none', 'important');
    el.setAttribute('data-trst-hidden', '1');
    return true;
  }
  return false;
}

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) hideSmallestMatch(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });

// Defensive initial pass in case a menu is already in the DOM on load.
if (document.body) {
  hideSmallestMatch(document.body);
}

// --- Relay between interceptor.js (MAIN world, watches Phrasly's own
// fetch calls) and background.js (the only thing that can actually reach
// our server). This script runs isolated-world, extension-privileged, so
// it's exempt from Phrasly's page CSP for its own chrome.runtime calls —
// interceptor.js can't talk to the extension directly, only via DOM-level
// postMessage, which isn't restricted by connect-src. ---
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const d = event.data;
  if (!d || d.source !== 'trst-interceptor' || d.type !== 'check') return;

  chrome.runtime.sendMessage(
    { type: 'trst_check_usage', feature: d.feature },
    (response) => {
      const allowed = !chrome.runtime.lastError && response && response.allowed;
      window.postMessage(
        { source: 'trst-interceptor-reply', requestId: d.requestId, allowed },
        window.location.origin
      );
    }
  );
});
