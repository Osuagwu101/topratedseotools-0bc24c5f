import { createFileRoute } from "@tanstack/react-router";
import { whoami, oneclickFailure } from "@/lib/phrasly-extension/backend.server";
export const Route = createFileRoute("/ext-whoami.php")({
  server: { handlers: { GET: async ({ request }) => {
    try { return await whoami(request); }
    catch(error) { return oneclickFailure(error,true); }
  } } }
});
