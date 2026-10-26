/** Port of the recovered AWS first-party token/limit protocol. Not a provider login. */
import { createHmac, timingSafeEqual } from "node:crypto";

export type PhraslyFeature = "humanizer" | "ai_detector" | "default";
export interface AwsClaims { uid: string | number; tool_id: string | number; exp: number; feature?: PhraslyFeature }
export interface AwsDecodedClaims extends Record<string, unknown> { uid: string | number; tool_id: string | number; exp: number; feature?: unknown }
export const HANDOFF_SECONDS = 60;
export const RECORD_SECONDS = 14_400;

function requireSecret(secret: string) {
  if (typeof secret !== "string" || Buffer.byteLength(secret) < 32) throw new Error("handoff_secret_required");
}
function identity(value: unknown): boolean {
  return (typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0);
}
function feature(value: unknown): value is PhraslyFeature {
  return value === "humanizer" || value === "ai_detector" || value === "default";
}
export function signAwsClaims(claims: AwsClaims, secret: string) {
  requireSecret(secret);
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  return { payload, signature };
}
export function issueAwsHandoff(uid: string | number, toolId: string | number, selected: PhraslyFeature, now: number, secret: string) {
  if (!identity(uid) || !identity(toolId) || !feature(selected) || !Number.isSafeInteger(now) || now < 0) throw new Error("bad_token");
  // Field order and signing representation match ext-handoff.php.
  return signAwsClaims({ uid, tool_id: toolId, feature: selected, exp: now + HANDOFF_SECONDS }, secret);
}
export function issueAwsRecordToken(uid: string | number, toolId: string | number, now: number, secret: string) {
  if (!identity(uid) || !identity(toolId) || !Number.isSafeInteger(now) || now < 0) throw new Error("bad_token");
  const token = signAwsClaims({ uid, tool_id: toolId, exp: now + RECORD_SECONDS }, secret);
  return `${token.payload}.${token.signature}`;
}
export function verifyAwsToken(payload: string, signature: string, kind: "handoff" | "record", now: number, secret: string): AwsDecodedClaims {
  requireSecret(secret);
  if (kind !== "handoff" && kind !== "record") throw new Error("bad_token");
  if (!Number.isSafeInteger(now) || now < 0 || typeof payload !== "string" || !/^[A-Za-z0-9_-]{1,2048}$/u.test(payload) ||
      typeof signature !== "string" || !/^[a-f0-9]{64}$/u.test(signature)) throw new Error("bad_token");
  const expected = createHmac("sha256", secret).update(payload).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new Error("bad_signature");
  let data: Record<string, unknown>;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new Error("bad_token"); }
  if (!data || typeof data !== "object" || Array.isArray(data) || !identity(data.uid) || !identity(data.tool_id) ||
      !Number.isSafeInteger(data.exp) || (data.exp as number) < 0) throw new Error("bad_token");
  // AWS has no cryptographic purpose claim, extra-field rejection or maximum
  // remaining-TTL check. Feature grants and account state are checked by the
  // real endpoints after verification; this decoder grants no access itself.
  if ((data.exp as number) < now) throw new Error("token_expired");
  return data as unknown as AwsDecodedClaims;
}
export function watUsageDay(now: number): string {
  return new Date((now + 3_600) * 1_000).toISOString().slice(0, 10);
}
export function secondsUntilWatReset(now: number): number {
  return Math.floor((now + 3_600) / 86_400) * 86_400 + 86_400 - 3_600 - now;
}
export function underDailyLimit(used: number, limit: number): boolean {
  return Number.isSafeInteger(used) && Number.isSafeInteger(limit) && used >= 0 && limit > 0 && used < limit;
}
