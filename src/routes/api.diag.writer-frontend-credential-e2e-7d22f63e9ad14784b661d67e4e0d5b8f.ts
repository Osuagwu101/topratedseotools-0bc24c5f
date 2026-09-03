import { createFileRoute } from "@tanstack/react-router";
import { createDecipheriv, createPublicKey, verify } from "crypto";

const PURPOSE = "writer-frontend-e2e";
const AUDIENCE = "topratedseotools-writer-e2e";
const REPOSITORY = "Osuagwu101/topratedseotools-0bc24c5f";
const REF = "refs/heads/main";
const WORKFLOW_REF =
  "Osuagwu101/topratedseotools-0bc24c5f/.github/workflows/one-time-writer-frontend-e2e.yml@refs/heads/main";

const WRITERS = [
  "viralliam3@gmail.com",
  "smartmove1914@gmail.com",
  "umarsuraka@gmail.com",
] as const;

const HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: HEADERS });
}

function b64urlJson(input: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

async function verifyGitHubOidc(jwt: string): Promise<boolean> {
  const parts = jwt.split(".");
  if (parts.length !== 3) return false;

  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (!header || !payload || header.alg !== "RS256" || typeof header.kid !== "string") return false;

  const now = Math.floor(Date.now() / 1000);
  const aud = payload.aud;
  const audOk =
    aud === AUDIENCE ||
    (Array.isArray(aud) && aud.some((v) => typeof v === "string" && v === AUDIENCE));

  if (
    payload.iss !== "https://token.actions.githubusercontent.com" ||
    !audOk ||
    payload.repository !== REPOSITORY ||
    payload.ref !== REF ||
    payload.workflow_ref !== WORKFLOW_REF ||
    typeof payload.exp !== "number" ||
    payload.exp < now - 30 ||
    (typeof payload.nbf === "number" && payload.nbf > now + 30)
  ) {
    return false;
  }

  try {
    const response = await fetch("https://token.actions.githubusercontent.com/.well-known/jwks", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return false;
    const jwks = (await response.json()) as { keys?: Array<Record<string, unknown>> };
    const jwk = jwks.keys?.find((k) => k.kid === header.kid);
    if (!jwk) return false;

    const key = createPublicKey({ key: jwk as any, format: "jwk" });
    return verify(
      "RSA-SHA256",
      Buffer.from(parts[0] + "." + parts[1], "utf8"),
      key,
      Buffer.from(parts[2], "base64url"),
    );
  } catch {
    return false;
  }
}

function decryptPassword(payload: string, nonce: string, keyValue: string): string | null {
  try {
    const key = Buffer.from(keyValue, "base64url");
    const iv = Buffer.from(nonce, "base64url");
    const combined = Buffer.from(payload, "base64url");
    if (key.length !== 32 || iv.length !== 12 || combined.length <= 16) return null;

    const ciphertext = combined.subarray(0, combined.length - 16);
    const tag = combined.subarray(combined.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from("writer-auth-reset-e2e", "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export const Route = createFileRoute(
  "/api/diag/writer-frontend-credential-e2e-7d22f63e9ad14784b661d67e4e0d5b8f",
)({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        if (!auth.startsWith("Bearer ")) return notFound();
        if (!(await verifyGitHubOidc(auth.slice(7).trim()))) return notFound();

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row, error } = await supabaseAdmin
          .from("one_time_diagnostic_tokens")
          .select("id, encrypted_payload, payload_nonce, payload_key")
          .eq("purpose", PURPOSE)
          .is("used_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (
          error ||
          !row ||
          typeof row.encrypted_payload !== "string" ||
          typeof row.payload_nonce !== "string" ||
          typeof row.payload_key !== "string"
        ) {
          return notFound();
        }

        const password = decryptPassword(row.encrypted_payload, row.payload_nonce, row.payload_key);
        if (!password || password.length < 8 || password.length > 200) return notFound();

        const { error: burnError } = await supabaseAdmin
          .from("one_time_diagnostic_tokens")
          .update({ used_at: new Date().toISOString() })
          .eq("id", row.id)
          .is("used_at", null);
        if (burnError) return notFound();

        return new Response(JSON.stringify({ writers: WRITERS, password }), {
          status: 200,
          headers: { ...HEADERS, "Content-Type": "application/json; charset=utf-8" },
        });
      },
      POST: async () => notFound(),
    },
  },
});
