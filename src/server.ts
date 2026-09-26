import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import {
  ensureStealthWriterAppDeviceResponse,
  handleStealthWriterProxyRequest,
  isDedicatedStealthWriterProxyRequest,
} from "./lib/stealthwriter-proxy.server";
import { stealthWriterProxyBootstrapResponse } from "./lib/stealthwriter-proxy-bootstrap.server";
import {
  handlePhraslyProxyRequest,
  isDedicatedPhraslyProxyRequest,
} from "./lib/phrasly-proxy.server";
import { phraslyProxyBootstrapResponse } from "./lib/phrasly-proxy-bootstrap.server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const dedicatedStealthWriterHost = isDedicatedStealthWriterProxyRequest(request);
      const dedicatedPhraslyHost = isDedicatedPhraslyProxyRequest(request);

      if (!dedicatedStealthWriterHost && url.pathname === "/api/stealthwriter-device") {
        if (request.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        return ensureStealthWriterAppDeviceResponse(request);
      }

      if (url.pathname === "/api/stealthwriter-proxy-bootstrap") {
        if (request.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        return stealthWriterProxyBootstrapResponse(
          dedicatedStealthWriterHost ? "" : "/api/stealthwriter-proxy",
        );
      }

      if (url.pathname === "/api/phrasly-proxy-bootstrap") {
        if (request.method !== "GET") {
          return new Response("Method not allowed", { status: 405 });
        }
        return phraslyProxyBootstrapResponse(
          dedicatedPhraslyHost ? "" : "/api/phrasly-proxy",
        );
      }

      // Dedicated proxy origins route every request through their fixed-host
      // proxy while the main site keeps the /api/* fallback routes.
      if (dedicatedStealthWriterHost) {
        return await handleStealthWriterProxyRequest(request);
      }
      if (dedicatedPhraslyHost) {
        return await handlePhraslyProxyRequest(request);
      }

      if (
        url.pathname === "/api/stealthwriter-proxy" ||
        url.pathname.startsWith("/api/stealthwriter-proxy/")
      ) {
        return await handleStealthWriterProxyRequest(request);
      }

      if (
        url.pathname === "/api/phrasly-proxy" ||
        url.pathname.startsWith("/api/phrasly-proxy/")
      ) {
        return await handlePhraslyProxyRequest(request);
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
