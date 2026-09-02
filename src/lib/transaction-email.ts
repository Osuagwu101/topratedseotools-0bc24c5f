/**
 * Best-effort receipt email helper. If the project has scaffolded
 * transactional email templates, we send the receipt; otherwise we still
 * flag the transaction row as receipt_sent so the audit trail is complete
 * without failing the whole request. Wire a real template by adding
 * `transaction-receipt` via the transactional email scaffolding.
 */
export interface ReceiptEmailInput {
  to: string;
  reference: string;
  status: string;
  amount: number | null;
  currency: string;
  toolLabel: string;
  accessType: string | null;
  billingPeriod: string | null;
  customerName: string | null;
  paidAt: string | null;
  channel: string | null;
  disclaimer: string | null;
}

export async function sendTransactionReceipt(
  input: ReceiptEmailInput,
): Promise<{ sent: boolean; reason?: string }> {
  try {
    const mod = (await import("@/lib/email-templates/send-email" as string).catch(() => null)) as {
      sendTemplateEmail?: (
        name: string,
        to: string,
        opts: { templateData: Record<string, unknown>; idempotencyKey?: string },
      ) => Promise<{ sent: boolean; reason?: string }>;
    } | null;
    if (!mod?.sendTemplateEmail) {
      return { sent: false, reason: "email_not_configured" };
    }
    return await mod.sendTemplateEmail("transaction-receipt", input.to, {
      templateData: input as unknown as Record<string, unknown>,
      idempotencyKey: `receipt-${input.reference}-${input.status}`,
    });
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}
