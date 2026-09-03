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
import {
  attachBrowserUsePage,
  waitForAuthOrOtp,
} from "@/lib/browser-auth-session.server";
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

const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });

function validProvider(v: unknown): BrowserAuthProvider | null {
  return v === "browser_use" || v === "cloudflare" ? v : null;
}

async function runDiagnostic(request: Request) {
  const { supabaseAdmin: admin } = await import(
    "@/integrations/supabase/client.server"
  );

  const url = new URL(request.url);
  const suppliedToken = url.searchParams.get("token")?.trim() ?? "";
  const { data: secret } = await (admin as any)
    .from("internal_secrets")
    .select("value")
    .eq("name", "PHRASLY_CONCURRENCY_DIAG_TOKEN")
    .maybeSingle();
  const expectedToken = String(secret?.value ?? "").trim();
  if (!expectedToken || suppliedToken !== expectedToken) return notFound();

  const toolSlug = "phrasly";

  const { data: global } = await (admin as any)
    .from("browser_auth_settings")
    .select("enabled, default_provider, session_timeout_minutes")
    .eq("id", true)
    .maybeSingle();
  if (!global?.enabled) {
    return json({ ok: false, stage: "preflight", error: "browser_auth_disabled" }, 409);
  }

  const { data: toolSetting } = await (admin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled, official_login_url, auth_provider")
    .eq("tool_slug", toolSlug)
    .maybeSingle();
  if (toolSetting?.enabled === false || !toolSetting?.one_click_auth_enabled) {
    return json(
      { ok: false, stage: "preflight", error: "phrasly_one_click_disabled" },
      409,
    );
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
  if (!account) {
    return json(
      { ok: false, stage: "preflight", error: "no_active_phrasly_account" },
      409,
    );
  }

  const { data: assignments } = await (admin as any)
    .from("tool_account_assignments")
    .select("user_id, account_id, status")
    .eq("tool_slug", toolSlug)
    .eq("account_id", account.id)
    .eq("status", "active");

  const distinctUserIds = Array.from(
    new Set((assignments ?? []).map((row: any) => String(row.user_id))),
  );

  if (distinctUserIds.length !== 3) {
    return json(
      {
        ok: false,
        stage: "preflight",
        error: "expected_exactly_three_active_writers",
        observed: distinctUserIds.length,
      },
      409,
    );
  }

  const { data: grants } = await (admin as any)
    .from("tool_access_grants")
    .select("user_id, account_id, status, expires_at")
    .in("user_id", distinctUserIds)
    .eq("tool_slug", toolSlug)
    .eq("account_id", account.id)
    .eq("status", "active");

  const accessOk = distinctUserIds.every((userId) =>
    (grants ?? []).some(
      (grant: any) =>
        String(grant.user_id) === userId &&
        (!grant.expires_at || new Date(grant.expires_at).getTime() > Date.now()),
    ),
  );
  if (!accessOk) {
    return json(
      { ok: false, stage: "preflight", error: "writer_access_preflight_failed" },
      409,
    );
  }

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
    return json(
      { ok: false, stage: "preflight", error: "shared_auth_state_not_ready" },
      409,
    );
  }

  const configuredLoginUrl = String(
    account.login_url ?? toolSetting?.official_login_url ?? "",
  ).trim();

  let landingUrl: string;
  try {
    if (new URL(configuredLoginUrl).protocol !== "https:") throw new Error();
    landingUrl = resolveSharedAuthLandingUrl(toolSlug, configuredLoginUrl);
  } catch {
    return json(
      { ok: false, stage: "preflight", error: "invalid_phrasly_login_url" },
      409,
    );
  }

  const state = {
    authenticated_cookies: saved.authenticated_cookies,
    session_tokens: saved.session_tokens,
  };

  const launches: Array<{
    slot: number;
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
      distinctUserIds.map(async (_userId, index) => {
        const launched =
          provider === "cloudflare"
            ? await launchCloudflareSessionOnly(admin, {
                loginUrl: landingUrl,
                timeoutMinutes,
                state,
              })
            : await launchBrowserUseSessionOnly(admin, {
                loginUrl: landingUrl,
                timeoutMinutes,
                state,
              });

        const item = {
          slot: index + 1,
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
          requestedWriters: 3,
          successfulLaunches: launches.length,
          failures,
        },
        502,
      );
    }

    launches.sort((a, b) => a.slot - b.slot);

    const uniqueProviderSessions =
      new Set(launches.map((x) => x.providerSessionId)).size === 3;
    const uniqueLiveUrls =
      new Set(launches.map((x) => x.liveUrl)).size === 3;

    const probes = await Promise.all(
      launches.map(async (launch) => {
        const cdp =
          provider === "cloudflare"
            ? await reconnectCloudflareSession(admin, launch.providerSessionId)
            : await reconnectBrowserUseSession(admin, launch.providerSessionId);
        if (!cdp) throw new Error(`reconnect_failed_slot_${launch.slot}`);

        try {
          const pageSessionId =
            provider === "browser_use"
              ? await attachBrowserUsePage(cdp, landingUrl)
              : undefined;

          const auth = await waitForAuthOrOtp(cdp, pageSessionId, 8_000);
          if (auth.status !== "authenticated") {
            throw new Error(`auth_not_confirmed_slot_${launch.slot}`);
          }

          const marker = `writer-${launch.slot}-${crypto.randomUUID()}`;
          const write = await cdp.send(
            "Runtime.evaluate",
            {
              expression: `(() => {
                const marker = ${JSON.stringify(marker)};
                sessionStorage.setItem("__trs_phrasly_isolation", marker);
                window.__trsPhraslyIsolation = marker;
                document.documentElement.dataset.trsPhraslyIsolation = marker;
                return {
                  marker: sessionStorage.getItem("__trs_phrasly_isolation"),
                  memory: window.__trsPhraslyIsolation,
                  dom: document.documentElement.dataset.trsPhraslyIsolation,
                  host: location.hostname,
                  path: location.pathname
                };
              })()`,
              returnByValue: true,
            },
            pageSessionId,
          );

          return {
            slot: launch.slot,
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

    // Mutate Writer 1 only after all three are live. Writers 2 and 3 must
    // retain only their own markers and must never see Writer 1's mutation.
    const writer1 = probes.find((probe) => probe.slot === 1)!;
    const writer1Mutation = `writer-1-mutated-${crypto.randomUUID()}`;
    await writer1.cdp.send(
      "Runtime.evaluate",
      {
        expression: `(() => {
          const marker = ${JSON.stringify(writer1Mutation)};
          sessionStorage.setItem("__trs_phrasly_action", marker);
          window.__trsPhraslyAction = marker;
          return marker;
        })()`,
        returnByValue: true,
      },
      writer1.pageSessionId,
    );

    await new Promise((resolve) => setTimeout(resolve, 750));

    const reads = await Promise.all(
      probes.map(async (probe) => {
        try {
          const read = await probe.cdp.send(
            "Runtime.evaluate",
            {
              expression: `(() => ({
                marker: sessionStorage.getItem("__trs_phrasly_isolation"),
                memory: window.__trsPhraslyIsolation,
                dom: document.documentElement.dataset.trsPhraslyIsolation,
                action: sessionStorage.getItem("__trs_phrasly_action"),
                memoryAction: window.__trsPhraslyAction || null,
                host: location.hostname,
                path: location.pathname
              }))()`,
              returnByValue: true,
            },
            probe.pageSessionId,
          );

          return {
            slot: probe.slot,
            expectedMarker: probe.marker,
            value: read?.result?.value ?? null,
          };
        } finally {
          probe.cdp.close();
        }
      }),
    );

    const isolationMarkersOk = reads.every(
      (read) =>
        read.value?.marker === read.expectedMarker &&
        read.value?.memory === read.expectedMarker &&
        read.value?.dom === read.expectedMarker,
    );

    const writer1ActionVisibleOnlyInWriter1 = reads.every((read) =>
      read.slot === 1
        ? read.value?.action === writer1Mutation &&
          read.value?.memoryAction === writer1Mutation
        : read.value?.action == null && read.value?.memoryAction == null,
    );

    const markersAreDistinct =
      new Set(reads.map((read) => read.value?.marker)).size === 3;
    const allOnPhrasly = reads.every((read) =>
      String(read.value?.host ?? "").endsWith("phrasly.ai"),
    );

    const ok =
      launches.length === 3 &&
      uniqueProviderSessions &&
      uniqueLiveUrls &&
      isolationMarkersOk &&
      writer1ActionVisibleOnlyInWriter1 &&
      markersAreDistinct &&
      allOnPhrasly;

    return json(
      {
        ok,
        stage: "complete",
        provider,
        requestedWriters: 3,
        authenticatedLaunches: launches.length,
        concurrentLaunchMs: Date.now() - startedAt,
        uniqueProviderSessions,
        uniqueLiveUrls,
        isolationMarkersOk,
        writer1ActionVisibleOnlyInWriter1,
        markersAreDistinct,
        allOnPhrasly,
      },
      ok ? 200 : 500,
    );
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
      GET: runDiagnostic,
      POST: async () => notFound(),
    },
  },
});
