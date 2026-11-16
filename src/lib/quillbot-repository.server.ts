/* Supabase adapter for the same server-only tables/query pattern as StealthWriter. */
import { activeQuillBotGrant, activeQuillBotOrder, type LaunchRepository } from "./quillbot-launch.server.ts";
export function quillBotRepository(db: any): LaunchRepository {
  const checked = async (query: any) => { const result = await query; if (result.error) throw new Error("QuillBot storage unavailable."); return result; };
  const getControls = async (user: string) => {
    const profile = await checked(db.from("profiles").select("account_status").eq("id", user).maybeSingle());
    if (!profile.data || profile.data.account_status !== "active") return { status: "suspended", provider_account_key: "account_1", device_limit: 2 };
    await checked(db.from("quillbot_user_controls").upsert({ user_id: user }, { onConflict: "user_id", ignoreDuplicates: true }));
    const result = await checked(db.from("quillbot_user_controls").select("status,provider_account_key,device_limit").eq("user_id", user).single());
    return result.data;
  };
  return {
    async enabled() {
      // This isolated gateway has its own switch; public tool settings are not changed.
      return process.env.QUILLBOT_TEST_ENABLED === "1";
    },
    async access(user) {
      const orders = await checked(db.from("tool_orders").select("id,expires_at,access_type,fulfilment_status,payment_status,status").eq("user_id", user).eq("tool_slug", "quillbot").eq("status", "approved").order("created_at", { ascending: false }).limit(20));
      const order = (orders.data ?? []).find((v: any) => activeQuillBotOrder(v));
      if (order) return { kind: "order", id: String(order.id) };
      const grants = await checked(db.from("tool_access_grants").select("id,expires_at,status").eq("user_id", user).eq("tool_slug", "quillbot").eq("status", "active").order("granted_at", { ascending: false }).limit(20));
      const grant = (grants.data ?? []).find((v: any) => activeQuillBotGrant(v));
      return grant ? { kind: "grant", id: String(grant.id) } : null;
    },
    async sourceActive(user, source) {
      const table = source.kind === "order" ? "tool_orders" : "tool_access_grants";
      const fields = source.kind === "order" ? "expires_at,access_type,fulfilment_status,payment_status,status" : "expires_at,status";
      const result = await checked(db.from(table).select(fields).eq("id", source.id).eq("user_id", user).eq("tool_slug", "quillbot").maybeSingle());
      return !!result.data && (source.kind === "order" ? activeQuillBotOrder(result.data) : activeQuillBotGrant(result.data));
    },
    controls: getControls,
    async providerReady(key) {
      const result = await checked(db.from("quillbot_provider_accounts").select("status,encrypted_payload").eq("account_key", key).maybeSingle());
      return result.data?.status === "stored" && !!result.data?.encrypted_payload;
    },
    async insert(row) { await checked(db.from("quillbot_proxy_sessions").insert(row)); },
    async find(hash, status) { return (await checked(db.from("quillbot_proxy_sessions").select("id,token_hash,user_id,source_kind,source_id,status,expires_at,device_fingerprint,provider_account_key").eq("token_hash", hash).eq("status", status).maybeSingle())).data; },
    async claim(row, next, now) {
      const result = await checked(db.from("quillbot_proxy_sessions").update({ ...next, status: "active", activated_at: now, last_seen_at: now }).eq("id", row.id).eq("token_hash", row.token_hash).eq("status", "issued").gt("expires_at", now).select("id").maybeSingle());
      return !!result.data;
    },
    async revoke(id) { await checked(db.from("quillbot_proxy_sessions").update({ status: "revoked" }).eq("id", id)); },
    async device(user, fingerprint, register) {
      if (register) return (await checked(db.rpc("register_quillbot_device", { _user_id: user, _fingerprint: fingerprint }))).data === true;
      return !!(await checked(db.from("quillbot_devices").select("id").eq("user_id", user).eq("device_fingerprint", fingerprint).maybeSingle())).data;
    },
    async touch(id, user, fingerprint) {
      const now = new Date().toISOString();
      await Promise.all([checked(db.from("quillbot_proxy_sessions").update({ last_seen_at: now }).eq("id", id)), checked(db.from("quillbot_devices").update({ last_seen_at: now }).eq("user_id", user).eq("device_fingerprint", fingerprint))]);
    },
  };
}
