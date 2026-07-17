export type AIProviderId = "openai" | "google" | "anthropic";

export interface ProviderModel {
  id: string;
  label: string;
}

export interface AIProvider {
  id: AIProviderId;
  label: string;
  /** Default model for this provider */
  defaultModel: string;
  /** Models we surface in the admin UI */
  models: ProviderModel[];
  /**
   * Whether the required credentials are configured in the current server env.
   * Called only on the server.
   */
  isConfigured(): boolean;
  /**
   * Ask the provider for a completion. Must return the assistant's text output.
   * Called only on the server.
   */
  complete(args: {
    model: string;
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<string>;
}
