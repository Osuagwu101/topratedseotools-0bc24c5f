/**
 * Flutterwave webhook route. Custom Payments are intercepted before the normal
 * tool-order pipeline, then ordinary events continue through the shared handler.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePaystackWebhook } from "@/lib/paystack-webhook";

export const Route = createFileRoute("/api/public/webhooks/flutterwave")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { loadGatewaySecrets } = await import("@/lib/gateways/secrets.server");
        await loadGatewaySecrets(supabaseAdmin, true);
        const { flutterwaveAdapter } = await import("@/lib/gateways/flutterwave");
        const { tryHandleCustomPaymentWebhook } = await import("@/lib/custom-payments.webhook");
        const custom = await tryHandleCustomPaymentWebhook(request.clone(), {
          gateway: "flutterwave",
          adapter: flutterwaveAdapter,
          supabaseAdmin,
        });
        if (custom) return custom;

        return handlePaystackWebhook(request, {
          secret: undefined,
          supabaseAdmin,
          adapter: flutterwaveAdapter,
        });
      },
    },
  },
});
