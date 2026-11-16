/* StealthWriter launch/control parity, with provider-specific storage injected.
 * Reference: stealthwriter-proxy.server.ts create/exchange/requireProxySession.
 * Only hashes are stored; upstream credentials never enter launch/session rows.
 */
import { createHash, randomBytes } from "node:crypto";

export const QUILLBOT_HANDOFF_TTL_SECONDS = 60;
export const QUILLBOT_PROXY_COOKIE = "trst_qb_proxy";
export const QUILLBOT_DEVICE_COOKIE = "trst_qb_device";
export const QUILLBOT_APP_DEVICE_COOKIE = "trst_app_device";
export type AccessSource = { kind: "order" | "grant"; id: string };
export type Controls = { status: string; provider_account_key: string; device_limit: number };
export type SessionRow = {
  id: string; token_hash: string; user_id: string; source_kind: "order" | "grant";
  source_id: string; status: string; expires_at: string; device_fingerprint: string | null;
  provider_account_key: string;
};
export interface LaunchRepository {
  enabled(): Promise<boolean>;
  access(userId: string): Promise<AccessSource | null>;
  sourceActive(userId: string, source: AccessSource): Promise<boolean>;
  controls(userId: string): Promise<Controls>;
  providerReady(key: string): Promise<boolean>;
  insert(row: Omit<SessionRow, "id">): Promise<void>;
  find(hash: string, status: "issued" | "active"): Promise<SessionRow | null>;
  claim(row: SessionRow, next: { token_hash: string; expires_at: string; device_fingerprint: string }, now: string): Promise<boolean>;
  revoke(id: string): Promise<void>;
  device(userId: string, fingerprint: string, register: boolean): Promise<boolean>;
  touch(id: string, userId: string, fingerprint: string): Promise<void>;
}
export class QuillBotAccessError extends Error {
  status: number;
  constructor(message: string, status = 403) { super(message); this.status = status; }
}
export const hashQuillBotProxyToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
export const validQuillBotDevice = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{32}$/.test(v);
export const validQuillBotAccount = (v: unknown): v is string => typeof v === "string" && /^account_[1-9][0-9]*$/.test(v);
export const activeQuillBotGrant = (row: { status?: string; expires_at?: string | null }, now = Date.now()) => row.status === "active" && (!row.expires_at || Date.parse(row.expires_at) > now);
export const activeQuillBotOrder = (row: { status?: string; payment_status?: string; expires_at?: string | null; access_type?: string; fulfilment_status?: string }, now = Date.now()) => row.status === "approved" && row.payment_status === "successful" && (!row.expires_at || Date.parse(row.expires_at) > now) && (row.access_type !== "private" || row.fulfilment_status === "active");
export function parseQuillBotCookies(request: Request) {
  const out = new Map<string, string>();
  for (const chunk of (request.headers.get("cookie") ?? "").split(";")) {
    const eq = chunk.indexOf("=");
    if (eq > 0) out.set(chunk.slice(0, eq).trim(), chunk.slice(eq + 1).trim());
  }
  return out;
}
export function quillBotSessionCookies(token: string, fingerprint: string, expires: string, base = "/__qbtest") {
  const flags = `Path=${base}; HttpOnly; Secure; SameSite=Lax`;
  return [
    `${QUILLBOT_PROXY_COOKIE}=${token}; ${flags}; Expires=${new Date(expires).toUTCString()}`,
    `${QUILLBOT_DEVICE_COOKIE}=${fingerprint}; ${flags}; Max-Age=31536000`,
  ];
}
export function createQuillBotLaunchService(repo: LaunchRepository, now = () => Date.now()) {
  async function gate(user: string, source: AccessSource | null, assigned?: string) {
    if (!(await repo.enabled()) || !source || !(await repo.sourceActive(user, source))) throw new QuillBotAccessError("Active QuillBot access is required.");
    const controls = await repo.controls(user);
    if (controls.status !== "active" || !validQuillBotAccount(controls.provider_account_key) || (assigned && assigned !== controls.provider_account_key)) throw new QuillBotAccessError("QuillBot access or account assignment changed.");
    if (!(await repo.providerReady(controls.provider_account_key))) throw new QuillBotAccessError("Admin must refresh the assigned QuillBot session.", 503);
    return controls;
  }
  return {
    async create(user: string, appDevice?: string | null) {
      const source = await repo.access(user);
      const controls = await gate(user, source);
      const token = randomBytes(32).toString("base64url");
      const expiry = new Date(now() + QUILLBOT_HANDOFF_TTL_SECONDS * 1000).toISOString();
      await repo.insert({ token_hash: hashQuillBotProxyToken(token), user_id: user, source_kind: source!.kind, source_id: source!.id, status: "issued", expires_at: expiry, device_fingerprint: validQuillBotDevice(appDevice) ? appDevice : null, provider_account_key: controls.provider_account_key });
      return { token, expiresAt: expiry };
    },
    async exchange(request: Request, ticket: string) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new QuillBotAccessError("Invalid launch ticket.", 401);
      const row = await repo.find(hashQuillBotProxyToken(ticket), "issued");
      if (!row || !(Date.parse(row.expires_at) > now())) throw new QuillBotAccessError("Expired or used launch ticket.", 401);
      try { await gate(row.user_id, { kind: row.source_kind, id: row.source_id }, row.provider_account_key); }
      catch (e) { await repo.revoke(row.id); throw e; }
      const cookies = parseQuillBotCookies(request);
      const existing = cookies.get(QUILLBOT_DEVICE_COOKIE);
      if (validQuillBotDevice(row.device_fingerprint) && validQuillBotDevice(existing) && existing !== row.device_fingerprint) throw new QuillBotAccessError("Device mismatch.", 401);
      const fingerprint = validQuillBotDevice(row.device_fingerprint) ? row.device_fingerprint : validQuillBotDevice(existing) ? existing : randomBytes(16).toString("hex");
      if (!(await repo.device(row.user_id, fingerprint, true))) throw new QuillBotAccessError("QuillBot device limit reached.");
      const token = randomBytes(32).toString("base64url");
      const daysInput = Number(process.env.QUILLBOT_PROXY_SESSION_DAYS ?? 30);
      const days = Number.isFinite(daysInput) ? Math.max(7, Math.min(30, Math.round(daysInput))) : 30;
      const expiresAt = new Date(now() + days * 86400000).toISOString();
      if (!(await repo.claim(row, { token_hash: hashQuillBotProxyToken(token), expires_at: expiresAt, device_fingerprint: fingerprint }, new Date(now()).toISOString()))) throw new QuillBotAccessError("Expired or used launch ticket.", 401);
      return { token, fingerprint, expiresAt };
    },
    async require(request: Request) {
      const cookies = parseQuillBotCookies(request);
      const token = cookies.get(QUILLBOT_PROXY_COOKIE);
      const fingerprint = cookies.get(QUILLBOT_DEVICE_COOKIE);
      if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token) || !validQuillBotDevice(fingerprint)) return null;
      const row = await repo.find(hashQuillBotProxyToken(token), "active");
      if (!row || row.device_fingerprint !== fingerprint) return null;
      if (!(Date.parse(row.expires_at) > now())) { await repo.revoke(row.id); return null; }
      try { await gate(row.user_id, { kind: row.source_kind, id: row.source_id }, row.provider_account_key); }
      catch (e) { if (e instanceof QuillBotAccessError && e.status !== 503) { await repo.revoke(row.id); return null; } throw e; }
      if (!(await repo.device(row.user_id, fingerprint, false))) { await repo.revoke(row.id); return null; }
      await repo.touch(row.id, row.user_id, fingerprint);
      return row;
    },
  };
}
