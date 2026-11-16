import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const db = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init = {}) => {
  const headers = new Headers(init.headers); headers.set("apikey", key);
  if (key.startsWith("sb_secret_") && headers.get("authorization") === "Bearer " + key) headers.delete("authorization");
  return fetch(input, { ...init, headers, signal: init.signal || AbortSignal.timeout(15000) });
} } });
