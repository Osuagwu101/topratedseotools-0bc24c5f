/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";

const SNEAKWRITE_SSO_URL = "https://sneakwrite.net/api/sso/toprated";
const DIRECT_SSO_TTL_MS = 90_000;

export const DIRECT_SSO_PROVIDER = "direct_sso" as const;

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export async function createSneakWriteSsoLaunch(
  admin: any,
  input: {
    userId: string;
    accountId?: string | null;
    targetEmail: string;
  },
) {
  const targetEmail = input.targetEmail.trim().toLowerCase();
  if (!targetEmail || !targetEmail.includes("@")) {
    throw new Error("The assigned SneakWrite account email is invalid. Contact Admin.");
  }

  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DIRECT_SSO_TTL_MS).toISOString();
  const { error } = await admin.from("direct_sso_tickets").insert({
    token_hash: sha256(ticket),
    user_id: input.userId,
    tool_slug: "sneakwrite",
    account_id: input.accountId ?? null,
    target_email: targetEmail,
    expires_at: expiresAt,
  });
  if (error) throw new Error("Could not create the SneakWrite secure handoff. Please try again.");

  const launchUrl = new URL(SNEAKWRITE_SSO_URL);
  launchUrl.searchParams.set("ticket", ticket);

  return {
    provider: DIRECT_SSO_PROVIDER,
    launchUrl: launchUrl.toString(),
    expiresAt,
  };
}

export function hashDirectSsoTicket(ticket: string) {
  return sha256(ticket);
}
