import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { openaiProvider } from "./openai";
import type { AIProvider, AIProviderId } from "./types";

/**
 * Central registry. Add a new provider by importing its adapter and
 * pushing it here — no other code changes required.
 */
export const PROVIDERS: Record<AIProviderId, AIProvider> = {
  openai: openaiProvider,
  google: googleProvider,
  anthropic: anthropicProvider,
};

export function getProvider(id: string): AIProvider {
  const p = PROVIDERS[id as AIProviderId];
  if (!p) throw new Error(`Unknown AI provider: ${id}`);
  return p;
}

export function listProviders(): AIProvider[] {
  return Object.values(PROVIDERS);
}

/** Safe metadata (no secret probing) for the admin UI. */
export function providerCatalog() {
  return listProviders().map((p) => ({
    id: p.id,
    label: p.label,
    defaultModel: p.defaultModel,
    models: p.models,
    configured: p.isConfigured(),
  }));
}
