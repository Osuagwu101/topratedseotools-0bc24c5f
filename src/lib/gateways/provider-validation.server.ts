/**
 * Live payment-provider credential checks.
 *
 * This module is server-only so Admin's Test action always executes the current
 * probe implementation rather than an inlined/stale server-function helper.
 */

export type ProviderConnectionResult = { ok: boolean; message: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runProviderConnectionTest(p: any): Promise<ProviderConnectionResult> {
  let ok = false;
  let message = "";

  try {
    if (p.slug === "paystack") {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        message = "Paystack secret key is not set.";
      } else {
        const response = await fetch("https://api.paystack.co/balance", {
          headers: { Authorization: `Bearer ${secret}` },
        });
        const body = (await response.json()) as { status?: boolean; message?: string };
        ok = response.ok && !!body.status;
        message = body.message ?? (ok ? "Connection successful" : `HTTP ${response.status}`);
      }
    } else if (p.slug === "flutterwave") {
      const secret = process.env.FLUTTERWAVE_SECRET_KEY;
      if (!secret) {
        message = "Flutterwave secret key is not set.";
      } else {
        // This is deliberately a merchant transaction-list probe. The platform
        // does not use subaccounts, split payments, marketplace payments, or
        // revenue sharing, so those resources are not valid credential checks.
        const response = await fetch("https://api.flutterwave.com/v3/transactions?page=1", {
          headers: { Authorization: `Bearer ${secret}` },
        });
        const body = (await response.json().catch(() => ({}))) as {
          status?: string;
          message?: string;
        };
        const authFailed =
          response.status === 401 ||
          response.status === 403 ||
          /authorization|unauthori|invalid.*(key|token)|token.*(expired|invalid)/i.test(
            body.message ?? "",
          );

        ok = !authFailed && response.status < 500;
        message = ok
          ? "Connection successful — merchant account reachable"
          : (body.message ?? `HTTP ${response.status}`);
      }
    } else if (p.slug === "monnify") {
      const apiKey = process.env.MONNIFY_API_KEY;
      const secretKey = process.env.MONNIFY_SECRET_KEY;
      const config = (p.config ?? {}) as Record<string, unknown>;
      const baseUrl = (config.base_url as string) || "https://api.monnify.com";
      if (!apiKey || !secretKey) {
        message = "Monnify API key and secret key must both be set.";
      } else if (!config.contract_code) {
        message = "Monnify contract code is missing.";
      } else {
        const basic = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
        const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
          method: "POST",
          headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        });
        const body = (await response.json()) as {
          requestSuccessful?: boolean;
          responseMessage?: string;
        };
        ok = response.ok && !!body.requestSuccessful;
        message = ok
          ? "Connection successful"
          : (body.responseMessage ?? `HTTP ${response.status}`);
      }
    } else {
      message = "Test connection is not implemented for this provider yet.";
    }
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }

  return { ok, message: message.slice(0, 500) };
}

export async function recordProviderTestResult(
  admin: any,
  id: string,
  result: ProviderConnectionResult,
): Promise<void> {
  await admin
    .from("payment_providers")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_status: result.ok ? "ok" : "failed",
      last_test_message: result.message,
    })
    .eq("id", id);
}
