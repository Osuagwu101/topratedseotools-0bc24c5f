import type { GatewayTransaction } from "./gateways/types";

/** Never discard an unverified checkout or treat an uncertain payment as failed. */
export async function recoverPendingPostpaidCheckout(deps: {
  reference: string | null;
  settlementEnvironment: string | null;
  gatewayEnvironment: string | null;
  verify: (reference: string) => Promise<GatewayTransaction>;
  markFailed: () => Promise<void>;
  confirm: (transaction: GatewayTransaction) => Promise<void>;
}): Promise<"pending" | "failed" | "confirmed"> {
  if (!deps.reference) {
    throw new Error("Your previous payment needs support verification before another can start.");
  }
  if (deps.settlementEnvironment &&
      deps.settlementEnvironment !== deps.gatewayEnvironment) {
    throw new Error("The payment-provider environment no longer matches this settlement.");
  }
  const tx = await deps.verify(deps.reference);
  if (tx.reference !== deps.reference) {
    throw new Error("Postpaid settlement reference verification failed.");
  }
  if (tx.status === "pending") return "pending";
  if (tx.status === "failed") {
    await deps.markFailed();
    return "failed";
  }
  // The caller validates currency, amount and ownership metadata before allocation.
  await deps.confirm(tx);
  return "confirmed";
}
