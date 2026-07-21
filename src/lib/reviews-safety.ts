/**
 * Client-safe content checks for customer reviews.
 *
 * Rejects reviews that would publicly expose emails, phone numbers, URLs,
 * payment card numbers, credentials, or obvious abusive content. Returns
 * `{ ok: false, reason }` so callers can render the warning inline.
 *
 * We intentionally err on the side of blocking risky content — false
 * negatives are safe (admin can hide later); false positives on emails,
 * phones and payment data are not (customer data leak).
 */
export interface SafetyResult {
  ok: boolean;
  reason?: string;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/i;
const URL = /(?:https?:\/\/|www\.)\S+/i;
// Very loose phone matcher: 8+ digits, common separators.
const PHONE = /(?:\+?\d[\d\s\-().]{7,}\d)/;
// Credit-card-ish 13–19 digit run.
const CARD = /\b\d{13,19}\b/;
const PAYMENT_WORDS =
  /\b(?:cvv|iban|routing\s*number|account\s*number|sort\s*code|swift\s*code|bvn|debit\s*card|credit\s*card)\b/i;
const CREDENTIAL_WORDS =
  /\b(?:password|passcode|pin|otp|two[- ]?factor|login\s*details|credentials|username\s*[:=])\b/i;
// Minimal profanity/abuse guard — deliberately short & non-exhaustive.
const ABUSE = /\b(?:fuck|shit|bitch|asshole|slut|nigger|faggot|retard)\b/i;

export function checkReviewSafety(input: {
  title: string;
  body: string;
  display_name?: string | null;
}): SafetyResult {
  const parts: string[] = [input.title, input.body];
  if (input.display_name) parts.push(input.display_name);
  const blob = parts.join("\n");

  if (EMAIL.test(blob))
    return { ok: false, reason: "Please remove any email addresses from your review." };
  if (PHONE.test(blob))
    return { ok: false, reason: "Please remove phone numbers from your review." };
  if (URL.test(blob))
    return { ok: false, reason: "Please remove links from your review." };
  if (CARD.test(blob) || PAYMENT_WORDS.test(blob))
    return { ok: false, reason: "Please remove payment or bank information from your review." };
  if (CREDENTIAL_WORDS.test(blob))
    return {
      ok: false,
      reason:
        "Please do not include login details, passwords or credentials in your review.",
    };
  if (ABUSE.test(blob))
    return { ok: false, reason: "Please rewrite your review without abusive language." };

  const cleanedTitle = input.title.trim();
  const cleanedBody = input.body.trim();
  if (cleanedTitle.length < 3 || cleanedTitle.length > 120)
    return { ok: false, reason: "Title must be between 3 and 120 characters." };
  if (cleanedBody.length < 10 || cleanedBody.length > 2000)
    return { ok: false, reason: "Review must be between 10 and 2000 characters." };
  return { ok: true };
}
