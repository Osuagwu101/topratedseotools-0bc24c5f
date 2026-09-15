import {
  resolveSessionBrowserProvider,
  usesWebsiteSavedBrowserState,
  supportsSelfHostedBrowser,
} from "../src/lib/browser-provider-policy.ts";

let passed = 0;
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
  passed++;
}

assert(
  resolveSessionBrowserProvider(null, "browser_use") === "browser_use",
  "Browser Use remains the default",
);
assert(
  resolveSessionBrowserProvider("self_hosted", "browser_use") === "self_hosted",
  "an explicit Self Hosted tool override is honored",
);
assert(
  resolveSessionBrowserProvider(null, "not-supported") === "browser_use",
  "clearing the override safely rolls back to Browser Use",
);
assert(
  usesWebsiteSavedBrowserState("browser_use"),
  "Browser Use keeps using existing website-managed saved state",
);
assert(
  !usesWebsiteSavedBrowserState("self_hosted"),
  "Self Hosted does not read or overwrite website-managed saved state",
);

console.log(`browser-provider-policy: ${passed} passed`);

assert(supportsSelfHostedBrowser("phrasly"), "Phrasly supports Self Hosted");
assert(supportsSelfHostedBrowser("stealthwriter"), "StealthWriter supports Self Hosted");
assert(supportsSelfHostedBrowser("chatgpt"), "ChatGPT supports Self Hosted");
assert(!supportsSelfHostedBrowser("canva"), "unsupported tools reject Self Hosted");
