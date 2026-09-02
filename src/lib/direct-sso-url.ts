const SNEAKWRITE_AUTH_ORIGIN = "https://rsnxhzlqxivpnpryzesu.supabase.co";
const SNEAKWRITE_AUTH_PATH = "/auth/v1/verify";
const SNEAKWRITE_APP_ORIGIN = "https://sneakwrite.net";
const SNEAKWRITE_APP_PATH = "/app";

export function validateSneakWriteLaunchUrl(rawUrl: string) {
  let launchUrl: URL;
  try {
    launchUrl = new URL(rawUrl);
  } catch {
    throw new Error("SneakWrite returned an invalid secure sign-in URL.");
  }

  if (launchUrl.origin !== SNEAKWRITE_AUTH_ORIGIN || launchUrl.pathname !== SNEAKWRITE_AUTH_PATH) {
    throw new Error("SneakWrite returned an invalid secure sign-in URL.");
  }
  if (launchUrl.searchParams.get("type") !== "magiclink") {
    throw new Error("SneakWrite returned an invalid secure sign-in URL.");
  }

  const redirectTo = launchUrl.searchParams.get("redirect_to");
  if (!redirectTo) throw new Error("SneakWrite returned an invalid secure sign-in URL.");

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(redirectTo);
  } catch {
    throw new Error("SneakWrite returned an invalid secure sign-in URL.");
  }
  if (
    redirectUrl.origin !== SNEAKWRITE_APP_ORIGIN ||
    redirectUrl.pathname !== SNEAKWRITE_APP_PATH
  ) {
    throw new Error("SneakWrite returned an invalid secure sign-in URL.");
  }

  return launchUrl.toString();
}
