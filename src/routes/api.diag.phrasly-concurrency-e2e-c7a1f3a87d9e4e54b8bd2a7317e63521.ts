import { createFileRoute } from "@tanstack/react-router";
import {
  closeRemoteBrowserSession,
  reconnectBrowserUseSession,
  reconnectCloudflareSession,
  type BrowserAuthProvider,
} from "@/lib/browser-auth.server";
import {
  launchBrowserUseSessionOnly,
  launchCloudflareSessionOnly,
} from "@/lib/shared-session-launch.server";
import { attachBrowserUsePage, waitForAuthOrOtp } from "@/lib/browser-auth-session.server";
import { resolveSharedAuthLandingUrl } from "@/lib/shared-auth-policy";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });

const notFound = () => new Response("Not found", { status: 404 });

function validProvider(v: unknown): BrowserAuthProvider | null {
  return v === "browser_use" || v === "cloudflare" ? v : null;
}

async function handler({ request }: { request: Request }) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

  const suppliedToken = request.headers.get("x-diag-token")?.trim() ?? "";
  const { data: secret } = await (admin as any)
    .from("internal_secrets")
    .select("value")
    .eq("name", "PHRASLY_CONCURRENCY_DIAG_TOKEN")
    .maybeSingle();
  const expectedToken = String(secret?.value ?? "").trim();
  if (!expectedToken || suppliedToken !== expectedToken) return notFound();

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const userIds = Array.isArray(body?.userIds)
    ? body.userIds.map((v: unknown) => String(v))
    : [];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (
    userIds.length !== 3 ||
    new Set(userIds).size !== 3 ||
    userIds.some((id: string) => !uuid.test(id))
  ) {
    return json({ ok: false, error: "exactly_three_distinct_user_ids_required" }, 400);
  }

  const toolSlug = "phrasly";

  const { data: global } = await (admin as any)
    .from("browser_auth_settings")
    .select("enabled, default_provider, session_timeout_minutes")
    .eq("id", true)
    .maybeSingle();
  if (!global?.enabled) return json({ ok: false, error: "browser_auth_disabled" }, 409);

  const { data: toolSetting } = await (admin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled, official_login_url, auth_provider")
    .eq("tool_slug", toolSlug)
    .maybeSingle();
  if (toolSetting?.enabled === false || !toolSetting?.one_click_auth_enabled) {
    return json({ ok: false, error: "phrasly_one_click_disabled" }, 409);
  }

  const { data: accounts } = await (admin as any)
    .from("tool_accounts")
    .select("id, login_url, enabled, status, expires_at")
    .eq("tool_slug", toolSlug)
    .eq("enabled", true)
    .eq("status", "working")
    .limit(5);
  const account = (accounts ?? []).find(
    (a: any) => !a.expires_at || new Date(a.expires_at).getTime() > Date.now(),
  );
  if (!account) return json({ ok: false, error: "no_active_phrasly_account" }, 409);

  const { data: grants } = await (admin as any)
    .from("tool_access_grants")
    .select("user_id, account_id, status, expires_at")
    .in("user_id", userIds)
    .eq("tool_slug", toolSlug)
    .eq("status", "active");
  const { data: assignments } = await (admin as any)
    .from("tool_account_assignments")
    .select("user_id, account_id, status")
    .in("user_id", userIds)
    .eq("tool_slug", toolSlug)
    .eq("status", "active");

  const accessOk = userIds.every((userId: string) => {
    const grant = (grants ?? []).find(
      (g: any) =>
        g.user_id === userId &&
        g.account_id === account.id &&
        (!g.expires_at || new Date(g.expires_at).getTime() > Date.now()),
    );
    const assignment = (assignments ?? []).find(
      (a: any) => a.user_id === userId && a.account_id === account.id,
    );
    return !!grant && !!assignment;
  });
  if (!accessOk) return json({ ok: false, error: "writer_access_preflight_failed" }, 409);

  const provider =
    validProvider(toolSetting?.auth_provider) ??
    validProvider(global.default_provider) ??
    "browser_use";
  const timeoutMinutes = Math.max(
    5,
    Math.min(30, Number(global.session_timeout_minutes ?? 30)),
  );

  const { data: saved } = await (admin as any)
    .from("tool_account_sessions")
    .select("authenticated_cookies, session_tokens, verification_status, expires_at")
    .eq("account_id", account.id)
    .eq("provider", provider)
    .maybeSingle();

  if (
    !saved ||
    saved.verification_status !== "active" ||
    !saved.expires_at ||
    new Date(saved.expires_at).getTime() <= Date.now() ||
    !Array.isArray(saved.authenticated_cookies) ||
    saved.authenticated_cookies.length === 0
  ) {
    return json({ ok: false, error: "shared_auth_state_not_ready" }, 409);
  }

  const configuredLoginUrl = String(
    account.login_url ?? toolSetting?.official_login_url ?? "",
  ).trim();
  let loginUrl: string;
  try {
    if (new URL(configuredLoginUrl).protocol !== "https:") throw new Error();
    loginUrl = resolveSharedAuthLandingUrl(toolSlug, configuredLoginUrl);
  } catch {
    return json({ ok: false, error: "invalid_phrasly_login_url" }, 409);
  }

  const state = {
    authenticated_cookies: saved.authenticated_cookies,
    session_tokens: saved.session_tokens,
  };

  const launches: Array<{
    userId: string;
    providerSessionId: string;
    liveUrl: string;
    expiresAt: string;
  }> = [];

  const cleanup = async () => {
    await Promise.all(
      launches.map((launch) =>
        closeRemoteBrowserSession(admin, provider, launch.providerSessionId),
      ),
    );
  };

  try {
    const startedAt = Date.now();
    const settled = await Promise.allSettled(
      userIds.map(async (userId: string) => {
        const launched =
          provider === "cloudflare"
            ? await launchCloudflareSessionOnly(admin, {
                loginUrl,
                timeoutMinutes,
                state,
              })
            : await launchBrowserUseSessionOnly(admin, {
                loginUrl,
                timeoutMinutes,
                state,
              });
        const item = {
          userId,
          providerSessionId: launched.providerSessionId,
          liveUrl: launched.liveUrl,
          expiresAt: launched.expiresAt,
        };
        launches.push(item);
        return item;
      }),
    );

    const failures = settled
      .map((result, index) =>
        result.status === "rejected"
          ? {
              slot: index + 1,
              message:
                result.reason instanceof Error
                  ? result.reason.message.slice(0, 180)
                  : "launch_failed",
            }
          : null,
      )
      .filter(Boolean);

    if (failures.length) {
      return json(
        {
          ok: false,
          stage: "concurrent_launch",
          successfulLaunches: launches.length,
          failures,
        },
        502,
      );
    }

    const uniqueProviderSessions =
      new Set(launches.map((x) => x.providerSessionId)).size === 3;
    const uniqueLiveUrls = new Set(launches.map((x) => x.liveUrl)).size === 3;

    const markerWrites = await Promise.all(
      launches.map(async (launch, index) => {
        const cdp =
          provider === "cloudflare"
            ? await reconnectCloudflareSession(admin, launch.providerSessionId)
            : await reconnectBrowserUseSession(admin, launch.providerSessionId);
        if (!cdp) throw new Error(`reconnect_failed_slot_${index + 1}`);

        try {
          const pageSessionId =
            provider === "browser_use"
              ? await attachBrowserUsePage(cdp, loginUrl)
              : undefined;
          const auth = await waitForAuthOrOtp(cdp, pageSessionId, 8_000);
          if (auth.status !== "authenticated") {
            throw new Error(`auth_not_confirmed_slot_${index + 1}`);
          }

          const marker = `writer-${index + 1}-${crypto.randomUUID()}`;
          const write = await cdp.send(
            "Runtime.evaluate",
            {
              expression: `(() => {
                const marker = ${JSON.stringify(marker)};
                sessionStorage.setItem("__phrasly_writer_diag", marker);
                window.__phraslyWriterDiag = marker;
                return {
                  marker: sessionStorage.getItem("__phrasly_writer_diag"),
                  memory: window.__phraslyWriterDiag,
                  host: location.hostname,
                  path: location.pathname
                };
              })()`,
              returnByValue: true,
            },
            pageSessionId,
          );

          return {
            userId: launch.userId,
            providerSessionId: launch.providerSessionId,
            marker,
            pageSessionId,
            cdp,
            firstRead: write?.result?.value ?? null,
          };
        } catch (error) {
          cdp.close();
          throw error;
        }
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 750));

    const secondReads = await Promise.all(
      markerWrites.map(async (item) => {
        try {
          const read = await item.cdp.send(
            "Runtime.evaluate",
            {
              expression: `(() => ({
                marker: sessionStorage.getItem("__phrasly_writer_diag"),
                memory: window.__phraslyWriterDiag,
                host: location.hostname,
                path: location.pathname
              }))()`,
              returnByValue: true,
            },
            item.pageSessionId,
          );
          return {
            userId: item.userId,
            expected: item.marker,
            value: read?.result?.value ?? null,
          };
        } finally {
          item.cdp.close();
        }
      }),
    );

    const isolationMarkersOk = secondReads.every(
      (read) =>
        read.value?.marker === read.expected &&
        read.value?.memory === read.expected &&
        read.value?.host?.endsWith("phrasly.ai"),
    );
    const observedMarkers = secondReads.map((read) => read.value?.marker);
    const markersAreDistinct = new Set(observedMarkers).size === 3;

    const ok =
      launches.length === 3 &&
      uniqueProviderSessions &&
      uniqueLiveUrls &&
      isolationMarkersOk &&
      markersAreDistinct;

    return json({
      ok,
      provider,
      requestedWriters: 3,
      authenticatedLaunches: launches.length,
      concurrentLaunchMs: Date.now() - startedAt,
      uniqueProviderSessions,
      uniqueLiveUrls,
      isolationMarkersOk,
      markersAreDistinct,
      allOnPhrasly: secondReads.every((read) =>
        String(read.value?.host ?? "").endsWith("phrasly.ai"),
      ),
    }, ok ? 200 : 500);
  } catch (error) {
    return json(
      {
        ok: false,
        stage: "isolation_check",
        message:
          error instanceof Error
            ? error.message.slice(0, 180)
            : "diagnostic_failed",
      },
      500,
    );
  } finally {
    await cleanup();
  }
}

export const Route = createFileRoute(
  "/api/diag/phrasly-concurrency-e2e-c7a1f3a87d9e4e54b8bd2a7317e63521",
)({
  server: {
    handlers: {
      GET: async () => notFound(),
      POST: handler,
    },
  },
});
