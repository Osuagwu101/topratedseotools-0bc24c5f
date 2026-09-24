/* Phase 5.1 — AWS-parity StealthWriter feature, usage and device controls. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type StealthWriterFeatureKey = "humanizer" | "ai_detector";

export interface StealthWriterUserControls {
  user_id: string;
  status: "active" | "suspended";
  device_limit: number;
  humanizer_enabled: boolean;
  humanizer_daily_limit: number;
  ai_detector_enabled: boolean;
  ai_detector_daily_limit: number;
  suspended_reason: string | null;
  suspended_at: string | null;
}

export const STEALTHWRITER_DEFAULT_DEVICE_LIMIT = 2;
export const STEALTHWRITER_DEFAULT_DAILY_LIMIT = 20;
export const STEALTHWRITER_DEVICE_COOKIE = "trst_sw_device";

const DEFAULT_HUMANIZER_DOCUMENT_PATHS = ["/dashboard/humanizer"] as const;
const DEFAULT_AI_DETECTOR_DOCUMENT_PATHS = ["/dashboard/ai-detector"] as const;
const COMMON_DOCUMENT_PATHS = ["/dashboard$"] as const;

const HUMANIZER_USAGE_PATHS = ["/api/humanize"] as const;
// The recovered AWS source references both names in different places; accept
// both so a backend rename cannot silently bypass the per-feature counter.
const AI_DETECTOR_USAGE_PATHS = ["/api/scan", "/api/detect"] as const;

function parsePathList(raw: string | undefined, fallback: readonly string[]) {
  const values = String(raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.startsWith("/") && v.length <= 200);
  return values.length ? values : [...fallback];
}

export function stealthWriterFeatureDocumentPaths() {
  return {
    common: [...COMMON_DOCUMENT_PATHS],
    humanizer: parsePathList(
      process.env.STEALTHWRITER_HUMANIZER_PATHS,
      DEFAULT_HUMANIZER_DOCUMENT_PATHS,
    ),
    ai_detector: parsePathList(
      process.env.STEALTHWRITER_AI_DETECTOR_PATHS,
      DEFAULT_AI_DETECTOR_DOCUMENT_PATHS,
    ),
  };
}

export function stealthWriterAllowedAssetHosts() {
  const defaults = ["www.stealthwriter.ai", "app.stealthwriter.ai", "beta.stealthwriter.ai"];
  const supplied = String(process.env.STEALTHWRITER_ASSET_HOSTS ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

  return [...new Set([...defaults, ...supplied])].filter(
    (host) =>
      host !== "stealthwriter.ai" &&
      (host === "www.stealthwriter.ai" || host.endsWith(".stealthwriter.ai")),
  );
}

export function pathMatchesStealthWriterRule(pathname: string, rule: string) {
  if (!rule) return false;
  if (rule.endsWith("$")) return pathname === rule.slice(0, -1);
  return pathname === rule || pathname.startsWith(rule.endsWith("/") ? rule : rule + "/");
}

export function grantedStealthWriterFeatures(
  controls: Pick<
    StealthWriterUserControls,
    "status" | "humanizer_enabled" | "ai_detector_enabled"
  >,
): StealthWriterFeatureKey[] {
  if (controls.status !== "active") return [];
  const out: StealthWriterFeatureKey[] = [];
  if (controls.humanizer_enabled) out.push("humanizer");
  if (controls.ai_detector_enabled) out.push("ai_detector");
  return out;
}

export function isAllowedStealthWriterDocumentPath(
  pathname: string,
  features: readonly StealthWriterFeatureKey[],
) {
  const paths = stealthWriterFeatureDocumentPaths();
  if (paths.common.some((rule) => pathMatchesStealthWriterRule(pathname, rule))) {
    return true;
  }
  return features.some((feature) =>
    paths[feature].some((rule) => pathMatchesStealthWriterRule(pathname, rule)),
  );
}

export function pickStealthWriterLandingPath(
  features: readonly StealthWriterFeatureKey[],
) {
  const paths = stealthWriterFeatureDocumentPaths();
  for (const preferred of ["humanizer", "ai_detector"] as const) {
    if (features.includes(preferred) && paths[preferred][0]) {
      return paths[preferred][0].replace(/\$$/, "");
    }
  }
  return paths.common[0]?.replace(/\$$/, "") || "/dashboard";
}

export function featureForStealthWriterUsagePath(
  pathname: string,
): StealthWriterFeatureKey | null {
  if (
    HUMANIZER_USAGE_PATHS.some(
      (path) => pathname === path || pathname.startsWith(path + "/"),
    )
  ) {
    return "humanizer";
  }
  if (
    AI_DETECTOR_USAGE_PATHS.some(
      (path) => pathname === path || pathname.startsWith(path + "/"),
    )
  ) {
    return "ai_detector";
  }
  return null;
}

export function isFreeStealthWriterRehumanize(
  feature: StealthWriterFeatureKey,
  request: Request,
) {
  return (
    feature === "humanizer" &&
    request.headers.get("x-oc-free-rehumanize") === "1"
  );
}

export function isValidStealthWriterDeviceFingerprint(value: string | undefined | null) {
  return !!value && /^[a-f0-9]{32}$/.test(value);
}

export function secondsUntilNextLagosMidnight(now = new Date()) {
  // WAT is UTC+1 year-round (Nigeria has no DST).
  const lagos = new Date(now.getTime() + 60 * 60 * 1000);
  const nextUtcMs =
    Date.UTC(
      lagos.getUTCFullYear(),
      lagos.getUTCMonth(),
      lagos.getUTCDate() + 1,
      0,
      0,
      0,
    ) -
    60 * 60 * 1000;
  return Math.max(0, Math.floor((nextUtcMs - now.getTime()) / 1000));
}

export async function ensureStealthWriterUserControls(
  userId: string,
): Promise<StealthWriterUserControls> {
  const { data: existing, error: readError } = await (supabaseAdmin as any)
    .from("stealthwriter_user_controls")
    .select(
      "user_id,status,device_limit,humanizer_enabled,humanizer_daily_limit,ai_detector_enabled,ai_detector_daily_limit,suspended_reason,suspended_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) return existing as StealthWriterUserControls;

  const { data, error } = await (supabaseAdmin as any)
    .from("stealthwriter_user_controls")
    .insert({
      user_id: userId,
      status: "active",
      device_limit: STEALTHWRITER_DEFAULT_DEVICE_LIMIT,
      humanizer_enabled: true,
      humanizer_daily_limit: STEALTHWRITER_DEFAULT_DAILY_LIMIT,
      ai_detector_enabled: true,
      ai_detector_daily_limit: STEALTHWRITER_DEFAULT_DAILY_LIMIT,
    })
    .select(
      "user_id,status,device_limit,humanizer_enabled,humanizer_daily_limit,ai_detector_enabled,ai_detector_daily_limit,suspended_reason,suspended_at",
    )
    .single();
  if (error) throw new Error(error.message);
  return data as StealthWriterUserControls;
}

export async function getStealthWriterUsageSnapshot(userId: string) {
  const controls = await ensureStealthWriterUserControls(userId);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { data: rows, error } = await (supabaseAdmin as any)
    .from("stealthwriter_daily_usage")
    .select("feature_key,count")
    .eq("user_id", userId)
    .eq("usage_day", today);
  if (error) throw new Error(error.message);

  const counts = new Map<string, number>(
    ((rows ?? []) as any[]).map((row) => [String(row.feature_key), Number(row.count ?? 0)]),
  );

  const features = {
    humanizer: {
      label: "Humanizer",
      enabled: controls.status === "active" && controls.humanizer_enabled,
      used: counts.get("humanizer") ?? 0,
      limit: controls.humanizer_daily_limit,
    },
    ai_detector: {
      label: "AI Detector",
      enabled: controls.status === "active" && controls.ai_detector_enabled,
      used: counts.get("ai_detector") ?? 0,
      limit: controls.ai_detector_daily_limit,
    },
  };

  return {
    status: controls.status,
    features,
    allowed_document_paths: stealthWriterFeatureDocumentPaths(),
    landing_path: pickStealthWriterLandingPath(grantedStealthWriterFeatures(controls)),
    resets_in: secondsUntilNextLagosMidnight(),
  };
}

export async function consumeStealthWriterUsage(
  userId: string,
  feature: StealthWriterFeatureKey,
  freeRehumanize: boolean,
) {
  const { data, error } = await (supabaseAdmin as any).rpc(
    "consume_stealthwriter_usage",
    {
      _user_id: userId,
      _feature_key: feature,
      _free_rehumanize: freeRehumanize,
    },
  );
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: !!row?.allowed,
    used: Number(row?.used ?? 0),
    dailyLimit: Number(row?.daily_limit ?? 0),
  };
}

export async function getStealthWriterUserLabel(userId: string) {
  const { data } = await (supabaseAdmin as any)
    .from("profiles")
    .select("full_name,email")
    .eq("id", userId)
    .maybeSingle();
  const fullName = String(data?.full_name ?? "").trim();
  const email = String(data?.email ?? "").trim();
  return fullName && email ? `${fullName} (${email})` : fullName || email || "Customer";
}

export async function registerOrTouchStealthWriterDevice(
  userId: string,
  fingerprint: string,
  label: string,
) {
  const controls = await ensureStealthWriterUserControls(userId);
  if (controls.status !== "active") {
    return { ok: false as const, suspended: true as const, controls };
  }

  const { data: existing, error: readError } = await (supabaseAdmin as any)
    .from("stealthwriter_devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_fingerprint", fingerprint)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (existing?.id) {
    await (supabaseAdmin as any)
      .from("stealthwriter_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { ok: true as const, isNew: false as const, controls };
  }

  const { count, error: countError } = await (supabaseAdmin as any)
    .from("stealthwriter_devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) throw new Error(countError.message);

  if ((count ?? 0) >= controls.device_limit) {
    const now = new Date().toISOString();
    await (supabaseAdmin as any)
      .from("stealthwriter_user_controls")
      .update({
        status: "suspended",
        suspended_reason: "device_limit_exceeded",
        suspended_at: now,
        updated_at: now,
      })
      .eq("user_id", userId);
    await (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
      .update({ status: "revoked" })
      .eq("user_id", userId)
      .in("status", ["issued", "active"]);
    return { ok: false as const, suspended: true as const, controls };
  }

  const { error: insertError } = await (supabaseAdmin as any)
    .from("stealthwriter_devices")
    .insert({
      user_id: userId,
      device_fingerprint: fingerprint,
      label: label.slice(0, 180) || "Device",
    });
  if (insertError) throw new Error(insertError.message);

  return { ok: true as const, isNew: true as const, controls };
}
