/* Native Admin pilot only. Never return/store/log cookies or ticket values. */
const SITE = "https://topratedseotools.com";
function allowedSender(sender) {
  try {
    const u = new URL(sender.url);
    return (
      u.origin === SITE &&
      /^\/admin\/tools\/claude\/?$/.test(u.pathname) &&
      (sender.frameId === undefined || sender.frameId === 0)
    );
  } catch {
    return false;
  }
}
async function launch(ticket) {
  if (typeof ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(ticket))
    return { ok: false, error: "Invalid pilot ticket" };
  const response = await fetch(SITE + "/api/claude-native/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || !result.ok)
    return { ok: false, error: result.error || "Pilot authorization failed" };
  const c = result.cookie;
  if (
    result.url !== "https://claude.ai/new" ||
    c?.name !== "sessionKey" ||
    c.domain !== ".claude.ai" ||
    c.path !== "/" ||
    typeof c.value !== "string" ||
    !c.value ||
    /[;\r\n\x00]/.test(c.value)
  )
    return { ok: false, error: "Invalid session response" };
  const existing = await chrome.cookies.getAll({ domain: "claude.ai", name: "sessionKey" });
  if (existing.some((old) => old.value !== c.value))
    return {
      ok: false,
      error:
        "This Chrome profile has another Claude login. Use a separate test profile; no cookies were changed.",
    };
  const mode = existing.length ? "existing" : "imported";
  if (mode === "imported") {
    const saved = await chrome.cookies.set({
      url: "https://claude.ai/",
      name: "sessionKey",
      value: c.value,
      domain: ".claude.ai",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      ...(typeof c.expirationDate === "number" && c.expirationDate > Date.now() / 1000
        ? { expirationDate: c.expirationDate }
        : {}),
    });
    if (!saved) return { ok: false, error: "Chrome could not save the pilot session" };
  }
  await chrome.tabs.create({ url: "https://claude.ai/new" });
  return { ok: true, mode };
}
chrome.runtime.onMessageExternal.addListener((message, sender, respond) => {
  if (!allowedSender(sender)) {
    respond({ ok: false, error: "Open the Claude Admin session page first" });
    return false;
  }
  if (message?.type === "trst_claude_pilot_ping") {
    respond({ ok: true, version: "0.1.0" });
    return false;
  }
  if (message?.type !== "trst_claude_native_pilot") return false;
  launch(message.ticket).then(respond, () =>
    respond({ ok: false, error: "Native Claude pilot failed. No session values were logged." }),
  );
  return true;
});
