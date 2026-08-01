/**
 * Paystack webhook route — thin wrapper over `handlePaystackWebhook`.
 * All behaviour lives in `src/lib/paystack-webhook.ts` so it can be tested.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePaystackWebhook } from "@/lib/paystack-webhook";

export const Route = createFileRoute("/api/public/webhooks/paystack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadGatewaySecrets } = await import("@/lib/gateways/secrets.server");
        await loadGatewaySecrets(supabaseAdmin, true);
        return handlePaystackWebhook(request, {
          secret: process.env.PAYSTACK_SECRET_KEY,
          supabaseAdmin,
        });
      },
    },
  },
});
