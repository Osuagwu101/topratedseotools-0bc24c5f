/**
 * Monnify webhook — HMAC SHA-512 of the raw body with the Monnify secret key,
 * sent in the `monnify-signature` header. Shares the Paystack pipeline for
 * idempotency, order completion, access assignment and emails.
 */
import { createFileRoute } from "@tanstack/react-router";
import { handlePaystackWebhook } from "@/lib/paystack-webhook";

export const Route = createFileRoute("/api/public/webhooks/monnify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Admin-entered gateway credentials (webhook hash) live in the DB.
        const { loadGatewaySecrets } = await import("@/lib/gateways/secrets.server");
        await loadGatewaySecrets(supabaseAdmin, true);
        const { createMonnifyAdapter } = await import("@/lib/gateways/monnify");
        const { data } = await supabaseAdmin
          .from("payment_providers")
          .select("config")
          .eq("slug", "monnify")
          .maybeSingle();
        const adapter = createMonnifyAdapter(
          ((data as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>,
        );

        const { tryHandleTurnitinPostpaidSettlementWebhook } = await import("@/lib/turnitin-postpaid-settlements.webhook");
        const { tryHandleTurnitinCreditWebhook } = await import("@/lib/turnitin-credit-payments.webhook");
        const turnitinPostpaid = await tryHandleTurnitinPostpaidSettlementWebhook(request.clone(), {
          gateway: "monnify",
          adapter: adapter,
          supabaseAdmin,
        });
        if (turnitinPostpaid) return turnitinPostpaid;

        const turnitinCredits = await tryHandleTurnitinCreditWebhook(request.clone(), {
          gateway: "monnify",
          adapter,
          supabaseAdmin,
        });
        if (turnitinCredits) return turnitinCredits;

        return handlePaystackWebhook(request, { secret: undefined, supabaseAdmin, adapter });
      },
    },
  },
});
