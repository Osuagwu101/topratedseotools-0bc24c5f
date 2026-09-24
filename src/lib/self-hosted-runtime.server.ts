/**
 * The standalone self-hosted browser runtime has been retired.
 *
 * These compatibility exports intentionally make no network requests. They
 * remain temporarily so persisted legacy configuration returns a clear error
 * instead of attempting to contact the retired service.
 */
export type SelfHostedLaunch = {
  provider: "self_hosted";
  providerSessionId: string;
  liveUrl: string;
  expiresAt: string;
};

export class SelfHostedAuthenticationNotReadyError extends Error {}

const RETIRED_MESSAGE = "The Self Hosted browser runtime has been discontinued.";

function retired(): never {
  throw new Error(RETIRED_MESSAGE);
}

export function signRuntimeRequest(_input: {
  method: string;
  path: string;
  writerId: string;
  body: string;
  timestamp: number;
  nonce: string;
  secret: string;
}): never {
  return retired();
}

export async function launchSelfHostedBrowser(
  _writerId: string,
  _toolSlug: string,
  _accountId: string,
): Promise<SelfHostedLaunch> {
  return retired();
}

export async function launchSelfHostedAdminAuthentication(
  _adminId: string,
  _toolSlug: string,
  _accountId: string,
): Promise<SelfHostedLaunch> {
  return retired();
}

export async function approveSelfHostedAdminAuthentication(
  _adminId: string,
  _toolSlug: string,
  _providerSessionId: string,
  _accountId: string,
): Promise<void> {
  return retired();
}

export async function closeSelfHostedAdminAuthentication(
  _adminId: string,
  _toolSlug: string,
  _providerSessionId: string,
  _accountId: string,
): Promise<void> {
  return retired();
}
