import {
  resolveAdminSecureLoginProvider,
  validSessionBrowserProvider,
} from "../src/lib/browser-provider-policy.ts";

let passed = 0;
function assert(value: unknown, message: string) {
  if (!value) throw new Error(message);
  passed++;
}

assert(
  resolveAdminSecureLoginProvider("browser_use", "self_hosted") === "browser_use",
  "explicit Browser Use secure login remains unchanged",
);
assert(
  resolveAdminSecureLoginProvider("self_hosted", "browser_use") === "self_hosted",
  "explicit Self Hosted secure login is selected",
);
assert(
  resolveAdminSecureLoginProvider(null, "browser_use") === "browser_use",
  "clearing the override rolls secure login back to Browser Use",
);
assert(
  validSessionBrowserProvider("unsupported") === null,
  "an unsupported persisted session provider is rejected",
);

let rejected = false;
try {
  resolveAdminSecureLoginProvider("unsupported", "browser_use");
} catch {
  rejected = true;
}
assert(rejected, "an invalid configured override fails safely");

console.log(`admin-secure-login-provider-routing: ${passed} passed`);
