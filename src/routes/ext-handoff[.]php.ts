import { createFileRoute } from "@tanstack/react-router";
import { handoff, oneclickFailure } from "@/lib/phrasly-extension/backend.server";
export const Route = createFileRoute("/ext-handoff.php")({
  server: { handlers: { GET: async ({ request }) => {
    try { return await handoff(request); }
    catch(error) { return oneclickFailure(error,false); }
  } } }
});
