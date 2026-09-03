import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";

/**
 * TEMPORARY one-time operational diagnostic — preview-runtime testing only.
 *
 * Resets the login password for exactly three pre-existing customer accounts through the
 * official Supabase Admin API so their frontend login can be exercised end to end.
 *
 * Authorisation is a single-use token stored ONLY as a SHA-256 hash in
 * `public.one_time_diagnostic_tokens` (purpose `writer-auth-reset-e2e`). No token and no
 * password value exists in this source file, and neither is logged, echoed or persisted.
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

type ResetResult = { userId: string; ok: boolean; error?: string };

export const Route = createFileRoute(
  "/api/diag/writer-auth-reset-e2e-820b5d66d7e8ca6d74a3fbc5fb108060",
)({
  server: {
    handlers: {
      // No GET behaviour whatsoever.
      GET: async () => notFound(),

      POST: async ({ request }) => {
        // ---- 1. Body: strictly { token, newPassword } ----------------------------------
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

        // ---- 3. Password length bounds (never logged, echoed or persisted) -------------
        if (newPassword.length < 8 || newPassword.length > 200) {
          return jsonResponse({ ok: false, results: [] }, 403);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // ---- 4. Validate the single-use token by SHA-256 hash, server-side ------------
        const tokenHash = sha256Hex(trimmedToken);
        const { data: tokenRow, error: tokenError } = await supabaseAdmin
          .from("one_time_diagnostic_tokens")
          .select("id")
          .eq("purpose", DIAGNOSTIC_PURPOSE)
          .eq("token_hash", tokenHash)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .maybeSingle();

        // ---- 5. Failure is indistinguishable from "route does not exist" --------------
        if (tokenError || !tokenRow) return notFound();

        // ---- 12. Hard guard: never touch an admin account ----------------------------
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

        // ---- 6/7. Reset each password, then clear the profile flag -------------------
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

        // ---- 8. Burn the token only on a fully successful run ------------------------
        if (allSucceeded) {
          await supabaseAdmin
            .from("one_time_diagnostic_tokens")
            .update({ used_at: new Date().toISOString() })
            .eq("id", tokenRow.id)
            .is("used_at", null);
        }

        // ---- 9. Response carries no password and no token ---------------------------
        return jsonResponse({ ok: allSucceeded, results }, allSucceeded ? 200 : 500);
      },
    },
  },
});
