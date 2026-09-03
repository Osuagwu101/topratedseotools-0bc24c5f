import { createFileRoute } from "@tanstack/react-router";
import { createDecipheriv, createHash } from "crypto";

/**
 * TEMPORARY one-time operational diagnostic — preview-runtime testing only.
 *
 * Resets the login password for exactly three pre-existing customer accounts through the
 * official Supabase Admin API so their frontend login can be exercised end to end.
 *
 * Authorisation is a single-use token stored ONLY as a SHA-256 hash in
 * `public.one_time_diagnostic_tokens` (purpose `writer-auth-reset-e2e`). No token and no
 * plaintext password value exists in this source file, and neither is logged, echoed or persisted.
 *
 * This file is self-contained and will be tombstoned immediately after the one-time test.
 */

const DIAGNOSTIC_PURPOSE = "writer-auth-reset-e2e";

/** Fixed customer user IDs. Nothing else may ever be mutated by this route. */
const TARGET_USER_IDS = [
  "af2eb433-4158-4026-b134-ca2f3d636475",
  "4df685e8-9ca0-4d2b-8116-16b16315bbc7",
  "909f7dde-42b6-49f9-a43a-ccf9dc2de3f7",
] as const;

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

/** Opaque response for every rejected request: no sensitive details, no oracle. */
function notFound(): Response {
  return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Keep provider error text short and free of any request-supplied material. */
function safeErrorMessage(error: unknown): string {
  const raw =
    typeof error === "string"
      ? error
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : "";
  const cleaned = raw.replace(/\s+/g, " ").trim();
  if (!cleaned) return "update_failed";
  return cleaned.slice(0, 160);
}

function decryptOneTimePassword(
  encryptedPayload: string,
  payloadNonce: string,
  keyBase64Url: string,
): string | null {
  try {
    const key = Buffer.from(keyBase64Url, "base64url");
    const nonce = Buffer.from(payloadNonce, "base64url");
    const combined = Buffer.from(encryptedPayload, "base64url");
    if (key.length !== 32 || nonce.length !== 12 || combined.length <= 16) return null;

    const ciphertext = combined.subarray(0, combined.length - 16);
    const authTag = combined.subarray(combined.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(Buffer.from(DIAGNOSTIC_PURPOSE, "utf8"));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

type ResetResult = { userId: string; ok: boolean; error?: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runReset(supabaseAdmin: any, tokenRowId: string, newPassword: string): Promise<Response> {
  const { data: adminRows, error: adminLookupError } = await supabaseAdmin
    .from("admin_accounts")
    .select("user_id")
    .in("user_id", TARGET_USER_IDS as unknown as string[]);

  if (adminLookupError) {
    return jsonResponse(
      {
        ok: false,
        results: TARGET_USER_IDS.map((userId) => ({
          userId,
          ok: false,
          error: "precheck_failed",
        })),
      },
      500,
    );
  }

  if (adminRows && adminRows.length > 0) {
    return jsonResponse(
      {
        ok: false,
        results: TARGET_USER_IDS.map((userId) => ({
          userId,
          ok: false,
          error: "admin_account_protected",
        })),
      },
      403,
    );
  }

  const results: ResetResult[] = [];

  for (const userId of TARGET_USER_IDS) {
    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
      email_confirm: true,
      user_metadata: { must_change_password: false },
    });

    if (updateError) {
      results.push({ userId, ok: false, error: safeErrorMessage(updateError) });
      continue;
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", userId);

    if (profileError) {
      results.push({ userId, ok: false, error: safeErrorMessage(profileError) });
      continue;
    }

    results.push({ userId, ok: true });
  }

  const allSucceeded = results.length === TARGET_USER_IDS.length && results.every((r) => r.ok);

  if (allSucceeded) {
    await supabaseAdmin
      .from("one_time_diagnostic_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("id", tokenRowId)
      .is("used_at", null);
  }

  return jsonResponse({ ok: allSucceeded, results }, allSucceeded ? 200 : 500);
}

export const Route = createFileRoute(
  "/api/diag/writer-auth-reset-e2e-820b5d66d7e8ca6d74a3fbc5fb108060",
)({
  server: {
    handlers: {
      /**
       * Encrypted one-time execution mode for test harnesses that can issue GET only.
       * The key is ephemeral; the encrypted payload is stored separately and the resulting
       * plaintext exists only in server memory for the duration of this request.
       */
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const entries = [...url.searchParams.entries()];
        if (
          entries.length !== 2 ||
          url.searchParams.getAll("token").length !== 1 ||
          url.searchParams.getAll("key").length !== 1
        ) {
          return notFound();
        }

        const token = url.searchParams.get("token")?.trim() ?? "";
        const key = url.searchParams.get("key")?.trim() ?? "";
        if (!token || !key) return notFound();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tokenHash = sha256Hex(token);
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
          .from("one_time_diagnostic_tokens")
          .select("id, encrypted_payload, payload_nonce")
          .eq("purpose", DIAGNOSTIC_PURPOSE)
          .eq("token_hash", tokenHash)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (
          tokenError ||
          !tokenRow ||
          typeof tokenRow.encrypted_payload !== "string" ||
          typeof tokenRow.payload_nonce !== "string"
        ) {
          return notFound();
        }

        const newPassword = decryptOneTimePassword(
          tokenRow.encrypted_payload,
          tokenRow.payload_nonce,
          key,
        );
        if (!newPassword || newPassword.length < 8 || newPassword.length > 200) return notFound();

        return runReset(supabaseAdmin, tokenRow.id, newPassword);
      },

      POST: async ({ request }) => {
        let parsed: unknown;
        try {
          parsed = await request.json();
        } catch {
          return notFound();
        }

        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return notFound();

        const keys = Object.keys(parsed as Record<string, unknown>);
        if (keys.length !== 2 || !keys.includes("token") || !keys.includes("newPassword")) {
          return notFound();
        }

        const { token, newPassword } = parsed as { token: unknown; newPassword: unknown };
        if (typeof token !== "string" || typeof newPassword !== "string") return notFound();

        const trimmedToken = token.trim();
        if (!trimmedToken) return notFound();
        if (newPassword.length < 8 || newPassword.length > 200) {
          return jsonResponse({ ok: false, results: [] }, 403);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const tokenHash = sha256Hex(trimmedToken);
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
          .from("one_time_diagnostic_tokens")
          .select("id")
          .eq("purpose", DIAGNOSTIC_PURPOSE)
          .eq("token_hash", tokenHash)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        if (tokenError || !tokenRow) return notFound();
        return runReset(supabaseAdmin, tokenRow.id, newPassword);
      },
    },
  },
});
