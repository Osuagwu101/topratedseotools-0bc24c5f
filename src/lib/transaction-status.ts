/**
 * Shared transaction / receipt helpers (pure, testable).
 *
 * These map raw Paystack statuses + our internal payment_status enum to a
 * single set of user-facing labels used everywhere receipts render.
 */

export type PaymentStatus =
  | "initiated"
  | "pending"
  | "processing"
  | "successful"
  | "failed"
  | "requires_review"
  | "refunded"
  | "reversed"
  | "abandoned";

export const RECEIPT_STATUS_LABEL: Record<PaymentStatus, string> = {
  initiated: "Payment Initiated",
  pending: "Payment Pending",
  processing: "Payment Processing",
  successful: "Payment Successful",
  failed: "Payment Failed",
  requires_review: "Payment Requires Review",
  refunded: "Payment Refunded",
  reversed: "Payment Reversed",
  abandoned: "Payment Abandoned",
};

/** Map a raw Paystack transaction status to our internal enum. */
export function mapPaystackStatus(raw: string | null | undefined): PaymentStatus {
  const s = String(raw ?? "").toLowerCase();
  if (s === "success" || s === "successful") return "successful";
  if (s === "failed") return "failed";
  if (s === "reversed") return "reversed";
  if (s === "abandoned") return "abandoned";
  if (s === "ongoing" || s === "processing") return "processing";
  if (s === "pending") return "pending";
  return "pending";
}

/** True when a receipt should carry the "this is not proof of payment" notice. */
export function isNonSuccessfulReceipt(status: PaymentStatus): boolean {
  return status !== "successful" && status !== "refunded";
}

export function receiptDisclaimer(status: PaymentStatus): string | null {
  if (status === "successful") return null;
  if (status === "refunded") return null;
  return "This is a transaction record and is not proof of successful payment.";
}
