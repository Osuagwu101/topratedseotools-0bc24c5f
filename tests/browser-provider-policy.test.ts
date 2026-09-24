import {
  resolveAdminSecureLoginProvider,
  resolveSessionBrowserProvider,
  validSessionBrowserProvider,
} from "../src/lib/browser-provider-policy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  validSessionBrowserProvider("browser_use") === "browser_use",
  "Browser Use remains supported",
);
assert(
  validSessionBrowserProvider("cloudflare") === "cloudflare",
  "Cloudflare remains supported",
);
assert(
  validSessionBrowserProvider("self_hosted") === null,
  "retired Self Hosted values are rejected",
);
assert(
  resolveSessionBrowserProvider("self_hosted", "browser_use") === "browser_use",
  "legacy tool values fall back to Browser Use",
);
assert(
  resolveAdminSecureLoginProvider("self_hosted", "cloudflare") === "cloudflare",
  "legacy admin settings fall back to a managed provider",
);

console.log("browser provider policy tests passed");
