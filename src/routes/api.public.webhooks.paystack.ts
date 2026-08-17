/**
 * Paystack webhook route.
 * Custom Payments are intercepted first because they are intentionally not
 * tool_orders; ordinary subscription/tool payments continue through the
 * existing, heavily-tested webhook handler unchanged.
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

        const { tryHandleCustomPaystackWebhook } = await import("@/lib/custom-payments.webhook");
        const custom = await tryHandleCustomPaystackWebhook(request.clone(), {
          secret: process.env.PAYSTACK_SECRET_KEY,
          supabaseAdmin,
        });
        if (custom) return custom;

        return handlePaystackWebhook(request, {
          secret: process.env.PAYSTACK_SECRET_KEY,
          supabaseAdmin,
        });
      },
    },
  },
});
