/**
 * Paystack webhook route. Custom Payments are intercepted first because they
 * are intentionally separate from tool_orders.
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
        const { paystackAdapter } = await import("@/lib/gateways/paystack");
        const { tryHandleCustomPaymentWebhook } = await import("@/lib/custom-payments.webhook");
        const custom = await tryHandleCustomPaymentWebhook(request.clone(), {
          gateway: "paystack",
          adapter: paystackAdapter,
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
