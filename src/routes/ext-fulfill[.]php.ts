import { createFileRoute } from "@tanstack/react-router";
import { fulfill, oneclickFailure } from "@/lib/phrasly-extension/backend.server";
export const Route = createFileRoute("/ext-fulfill.php")({
  server: { handlers: { GET: async ({ request }) => {
    try { return await fulfill(request); }
    catch(error) { return oneclickFailure(error,true); }
  } } }
});
