import { createFileRoute } from "@tanstack/react-router";
import { createPopupSession, oneclickFailure } from "@/lib/phrasly-extension/backend.server";
export const Route = createFileRoute("/ext-session")({
  server: { handlers: { POST: async ({ request }) => {
    try { return await createPopupSession(request); }
    catch(error) { return oneclickFailure(error,false); }
  } } }
});
