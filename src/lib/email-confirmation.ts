export type EmailLinkError = "expired" | "error";

// Legacy signup emails return to the homepage. Inspect errors before Auth
// processes the fragment; never treat a query parameter as proof of success.
export function emailLinkError(href: string): EmailLinkError | null {
  const url = new URL(href);
  if (url.pathname !== "/" && url.pathname !== "/login") return null;
  const hash = new URLSearchParams(url.hash.slice(1));
  const value = (key: string) => hash.get(key) || url.searchParams.get(key) || "";
  if (!value("error") && !value("error_code")) return null;
  return value("error_code") === "otp_expired" || /expired/i.test(value("error_description"))
    ? "expired" : "error";
}

export function emailConfirmationRedirect(origin: string): string {
  return new URL("/login?confirmation=check", origin).href;
}

export function isEmailNotConfirmed(error: { code?: string; message: string }): boolean {
  return error.code === "email_not_confirmed" || /email not confirmed/i.test(error.message);
}
