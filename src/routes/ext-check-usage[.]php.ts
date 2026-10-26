import { createFileRoute } from "@tanstack/react-router";
import { checkUsage, oneclickFailure } from "@/lib/phrasly-extension/backend.server";
export const Route = createFileRoute("/ext-check-usage.php")({
  server: { handlers: { POST: async ({ request }) => {
    try { return await checkUsage(request); }
    catch(error) { return oneclickFailure(error,true); }
  } } }
});
