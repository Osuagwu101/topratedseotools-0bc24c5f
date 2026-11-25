import { useEffect } from "react";
import { emailLinkError, turnitinAuthDestination } from "@/lib/email-confirmation";

const initialError = typeof window === "undefined" ? null : emailLinkError(window.location.href);

export function EmailConfirmationFeedback() {
  useEffect(() => {
    if (initialError) {
      // Remove callback credentials and never forward arbitrary redirects.
      const search = new URLSearchParams({ confirmation: initialError });
      const destination = turnitinAuthDestination(new URLSearchParams(window.location.search).get("redirect"));
      if (destination) search.set("redirect", destination);
      window.location.replace(`/login?${search}`);
    }
  }, []);
  return null;
}
