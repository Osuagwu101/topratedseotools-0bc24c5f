import { createFileRoute } from "@tanstack/react-router";
import { handleStealthWriterProxyRequest } from "@/lib/stealthwriter-proxy.server";

export const Route = createFileRoute("/api/stealthwriter-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => handleStealthWriterProxyRequest(request),
      HEAD: async ({ request }) => handleStealthWriterProxyRequest(request),
      POST: async ({ request }) => handleStealthWriterProxyRequest(request),
      PUT: async ({ request }) => handleStealthWriterProxyRequest(request),
      PATCH: async ({ request }) => handleStealthWriterProxyRequest(request),
      DELETE: async ({ request }) => handleStealthWriterProxyRequest(request),
      OPTIONS: async ({ request }) => handleStealthWriterProxyRequest(request),
    },
  },
});
