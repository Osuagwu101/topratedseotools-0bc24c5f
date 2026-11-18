import assert from "node:assert/strict";
import { emailLinkError, emailConfirmationRedirect, isEmailNotConfirmed } from "../src/lib/email-confirmation";

// Reproduce the expired Supabase callback that previously disappeared on the
// homepage, including old emails and the new login redirect destination.
for (const path of ["/", "/login?confirmation=check"]) {
  assert.equal(emailLinkError(`https://topratedseotools.com${path}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`), "expired");
}
assert.equal(emailLinkError("https://topratedseotools.com/?error=access_denied&error_description=Email+link+has+expired"), "expired");
assert.equal(emailLinkError("https://topratedseotools.com/#error=access_denied"), "error");

// Do not intercept password recovery, admin login, valid signup tokens or
// ordinary site navigation; a caller-controlled flag is never proof of success.
for (const href of [
  "https://topratedseotools.com/reset-password#error=access_denied&error_code=otp_expired",
  "https://topratedseotools.com/admin#error=access_denied",
  "https://topratedseotools.com/#access_token=test&type=signup",
  "https://topratedseotools.com/login?confirmation=confirmed",
  "https://topratedseotools.com/",
]) assert.equal(emailLinkError(href), null);
assert.equal(emailConfirmationRedirect("https://topratedseotools.com"), "https://topratedseotools.com/login?confirmation=check");
assert.equal(emailConfirmationRedirect("https://www.topratedseotools.com"), "https://www.topratedseotools.com/login?confirmation=check");
assert(isEmailNotConfirmed({ code: "email_not_confirmed", message: "Email not confirmed" }));
assert(isEmailNotConfirmed({ message: "Email not confirmed" }));
assert(!isEmailNotConfirmed({ code: "invalid_credentials", message: "Invalid login credentials" }));
console.log("Email confirmation regression checks passed");
