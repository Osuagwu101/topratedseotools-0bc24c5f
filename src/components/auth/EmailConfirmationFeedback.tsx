import { useEffect } from "react";
import { emailLinkError } from "@/lib/email-confirmation";

const initialError = typeof window === "undefined" ? null : emailLinkError(window.location.href);

export function EmailConfirmationFeedback() {
  useEffect(() => {
    if (initialError) {
      // Remove callback credentials and never forward arbitrary redirects.
      window.location.replace(`/login?confirmation=${initialError}`);
    }
  }, []);
  return null;
}
