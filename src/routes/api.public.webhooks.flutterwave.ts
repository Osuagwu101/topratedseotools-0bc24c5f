/**
 * Flutterwave webhook — signature is the shared `verif-hash` header.
 * Behaviour (idempotency, order completion, access, emails) is shared with
 * Paystack via `handlePaystackWebhook` + the Flutterwave adapter.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePaystackWebhook } from "@/lib/paystack-webhook";

export const Route = createFileRoute("/api/public/webhooks/flutterwave")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Admin-entered gateway credentials (webhook hash) live in the DB.
        const { loadGatewaySecrets } = await import("@/lib/gateways/secrets.server");
        await loadGatewaySecrets(supabaseAdmin, true);
        const { flutterwaveAdapter } = await import("@/lib/gateways/flutterwave");
        return handlePaystackWebhook(request, {
          secret: undefined,
          supabaseAdmin,
          adapter: flutterwaveAdapter,
        });
      },
    },
  },
});
