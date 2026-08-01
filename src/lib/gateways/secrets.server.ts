/**
 * Gateway credential store (server-only).
 *
 * Payment-gateway credentials can be provided two ways:
 *   1. Platform secret storage (environment variables), or
 *   2. Admin → Settings → Payments, which writes them into the
 *      service-role-only `internal_secrets` table (same pattern already used
 *      for the cron secret).
 *
 * `loadGatewaySecrets()` hydrates `process.env` from `internal_secrets` before
 * any adapter reads its credentials, so the adapters stay synchronous and the
 * abstraction layer is untouched. Values are never returned to the client —
 * only "is it configured" booleans surface in the admin UI.
 */

export const GATEWAY_SECRET_NAMES = [
  "PAYSTACK_SECRET_KEY",
  "FLUTTERWAVE_SECRET_KEY",
  "FLUTTERWAVE_PUBLIC_KEY",
  "FLUTTERWAVE_ENCRYPTION_KEY",
  "FLUTTERWAVE_WEBHOOK_HASH",
  "MONNIFY_API_KEY",
  "MONNIFY_SECRET_KEY",
] as const;

export type GatewaySecretName = (typeof GATEWAY_SECRET_NAMES)[number];

export function isGatewaySecretName(x: unknown): x is GatewaySecretName {
  return typeof x === "string" && (GATEWAY_SECRET_NAMES as readonly string[]).includes(x);
}

let lastLoadedAt = 0;
const TTL_MS = 15_000;

/**
 * Copy admin-managed gateway credentials from the database into process.env.
 * Admin-entered values win over build-time env values so rotating a key in the
 * dashboard takes effect immediately.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadGatewaySecrets(db: any, force = false): Promise<void> {
  if (!force && Date.now() - lastLoadedAt < TTL_MS) return;
  try {
    const { data } = await db
      .from("internal_secrets")
      .select("name, value")
      .in("name", GATEWAY_SECRET_NAMES as unknown as string[]);
    for (const row of (data ?? []) as Array<{ name: string; value: string }>) {
      const value = String(row.value ?? "").trim();
      if (!value) continue;
      if (isGatewaySecretName(row.name)) process.env[row.name] = value;
    }
    lastLoadedAt = Date.now();
  } catch {
    /* env-only configuration is still valid */
  }
}

/** Which of the requested credentials are present (env or admin-entered). */
export function missingSecrets(names: readonly string[]): string[] {
  return names.filter((n) => !String(process.env[n] ?? "").trim());
}
