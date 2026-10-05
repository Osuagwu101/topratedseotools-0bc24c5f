/*
 * Server-only authorised session primitives for the Turnitin/Originality Reports adapter.
 *
 * Values are kept opaque and encrypted at rest. The normaliser accepts a
 * structured first-party cookie export and rejects unrelated domains.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const AAD = Buffer.from(
  "topratedseotools:turnitin:originality_session_json:v1",
  "utf8",
);

export const TURNITIN_ORIGINALITY_AUTH_COOKIE = "turnitin_admin_session";

export type OriginalityStoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};

export type OriginalitySessionState = {
  version: 1;
  cookies: OriginalityStoredCookie[];
};

function isOriginalityDomain(raw: string): boolean {
  const host = raw.trim().toLowerCase().replace(/^\./, "");
  return host === "originality.report" || host.endsWith(".originality.report");
}

function ignoredCookie(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    /^(_ga|_gid|_gat|_utm)/.test(lower) ||
    [
      "_fbp",
      "_fbc",
      "_clck",
      "_clsk",
      "_uetmsclkid",
      "_uetsid",
      "_uetvid",
      "_ttp",
      "__cf_bm",
      "cf_clearance",
      "_cfuvid",
    ].includes(lower) ||
    lower.startsWith("intercom-") ||
    lower.startsWith("hubspot") ||
    lower.startsWith("ajs_") ||
    lower.startsWith("amplitude")
  );
}

function cleanCookieArray(value: unknown): OriginalityStoredCookie[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error(
      "Originality Reports session JSON must contain at least one first-party cookie.",
    );
  }
  if (value.length > 100) {
    throw new Error("Originality Reports session JSON contains too many cookies.");
  }

  const out: OriginalityStoredCookie[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Each Originality Reports cookie must be a JSON object.");
    }

    const source = raw as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const cookieValue = typeof source.value === "string" ? source.value : "";
    const domain =
      typeof source.domain === "string" && source.domain.trim()
        ? source.domain.trim()
        : ".originality.report";
    const path =
      typeof source.path === "string" && source.path.startsWith("/")
        ? source.path
        : "/";

    if (
      !name ||
      name.length > 256 ||
      cookieValue.length < 1 ||
      cookieValue.length > 128000
    ) {
      throw new Error(
        "Originality Reports session contains a missing or invalid cookie name/value.",
      );
    }
    if (!isOriginalityDomain(domain)) {
      throw new Error(
        `Refusing to store cookie "${name}" because its domain is not originality.report.`,
      );
    }
    if (ignoredCookie(name)) continue;

    const cookie: OriginalityStoredCookie = {
      name,
      value: cookieValue,
      domain,
      path,
    };
    if (typeof source.expires === "number" && Number.isFinite(source.expires)) {
      cookie.expires = source.expires;
    }
    if (typeof source.secure === "boolean") cookie.secure = source.secure;
    if (typeof source.httpOnly === "boolean") cookie.httpOnly = source.httpOnly;
    if (typeof source.sameSite === "string" && source.sameSite.length <= 32) {
      cookie.sameSite = source.sameSite;
    }
    out.push(cookie);
  }

  if (!out.length) {
    throw new Error(
      "No reusable first-party Originality Reports cookies remained after validation.",
    );
  }
  if (!out.some((cookie) => cookie.name === TURNITIN_ORIGINALITY_AUTH_COOKIE)) {
    throw new Error(
      'The Originality Reports login cookie "turnitin_admin_session" was not found.',
    );
  }
  return out;
}

function objectMapToCookies(value: Record<string, unknown>): OriginalityStoredCookie[] {
  const reserved = new Set(["version", "cookies", "authenticated_cookies"]);
  const entries = Object.entries(value).filter(([key]) => !reserved.has(key));
  if (
    entries.length < 1 ||
    entries.length > 100 ||
    entries.some(
      ([key, item]) =>
        !key ||
        key.length > 256 ||
        typeof item !== "string" ||
        item.length < 1 ||
        item.length > 128000,
    )
  ) {
    throw new Error(
      "Use a cookie JSON export or a simple JSON object of Originality Reports cookie names and values.",
    );
  }

  return cleanCookieArray(
    entries.map(([name, cookieValue]) => ({
      name,
      value: cookieValue,
      domain: ".originality.report",
      path: "/",
      secure: true,
    })),
  );
}

export function normaliseOriginalitySession(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Paste the Originality Reports "turnitin_admin_session" cookie value first.');
  }

  // Quick paste: Chrome DevTools exposes the authenticated session as the
  // HttpOnly cookie named turnitin_admin_session. Accept its bare Value or
  // turnitin_admin_session=<value> and wrap it into the canonical shape.
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    const prefix = `${TURNITIN_ORIGINALITY_AUTH_COOKIE}=`;
    const cookieValue = trimmed.startsWith(prefix)
      ? trimmed.slice(prefix.length)
      : trimmed;
    if (!cookieValue || cookieValue.length > 128000 || /[\r\n;]/.test(cookieValue)) {
      throw new Error('The "turnitin_admin_session" cookie value is invalid.');
    }
    return JSON.stringify({
      version: 1,
      cookies: [
        {
          name: TURNITIN_ORIGINALITY_AUTH_COOKIE,
          value: cookieValue,
          domain: ".originality.report",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ],
    } satisfies OriginalitySessionState);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      'Paste either the "turnitin_admin_session" cookie Value or valid cookie JSON.',
    );
  }

  let cookies: OriginalityStoredCookie[];
  if (Array.isArray(parsed)) {
    cookies = cleanCookieArray(parsed);
  } else if (parsed && typeof parsed === "object") {
    const source = parsed as Record<string, unknown>;
    if (Array.isArray(source.cookies) || Array.isArray(source.authenticated_cookies)) {
      cookies = cleanCookieArray(source.cookies ?? source.authenticated_cookies);
    } else {
      cookies = objectMapToCookies(source);
    }
  } else {
    throw new Error("Originality Reports session data must be a JSON object or cookie array.");
  }

  return JSON.stringify({
    version: 1,
    cookies,
  } satisfies OriginalitySessionState);
}

export function parseOriginalitySession(raw: string): OriginalitySessionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Stored Originality Reports session JSON is invalid.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Stored Originality Reports session JSON is invalid.");
  }
  const source = parsed as Record<string, unknown>;
  return {
    version: 1,
    cookies: cleanCookieArray(source.cookies),
  };
}

export function originalityCookieHeader(state: OriginalitySessionState): string {
  const nowSeconds = Date.now() / 1000;
  const usable = state.cookies.filter(
    (cookie) =>
      cookie.path.startsWith("/") &&
      (cookie.expires == null || cookie.expires <= 0 || cookie.expires > nowSeconds),
  );
  if (!usable.length) {
    throw new Error("The stored Originality Reports session has no unexpired cookies.");
  }
  return usable.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

function decodeEncryptionKey(rawInput?: string): Buffer {
  const raw = String(
    rawInput ?? process.env.TURNITIN_ORIGINALITY_SESSION_ENCRYPTION_KEY ?? "",
  ).trim();

  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error(
        "Turnitin Originality session encryption key must decode to exactly 32 bytes.",
      );
    }
    return key;
  }

  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (!serviceRoleKey) {
    throw new Error(
      "Turnitin Originality session encryption is not configured on the server.",
    );
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serviceRoleKey, "utf8"),
      Buffer.from("topratedseotools", "utf8"),
      Buffer.from("turnitin-originality-session-encryption:v1", "utf8"),
      32,
    ),
  );
}

export function encryptOriginalitySession(
  plaintext: string,
  keyMaterial?: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    decodeEncryptionKey(keyMaterial),
    iv,
  );
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ciphertext.toString("base64"),
  });
}

export function decryptOriginalitySession(
  envelope: string,
  keyMaterial?: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("Invalid Turnitin Originality session ciphertext.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Turnitin Originality session ciphertext.");
  }

  const value = parsed as Record<string, unknown>;
  if (
    value.v !== 1 ||
    value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ct !== "string"
  ) {
    throw new Error("Invalid Turnitin Originality session ciphertext.");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      decodeEncryptionKey(keyMaterial),
      Buffer.from(value.iv, "base64"),
    );
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(value.tag, "base64"));
    return (
      decipher.update(Buffer.from(value.ct, "base64")).toString("utf8") +
      decipher.final("utf8")
    );
  } catch {
    throw new Error("Could not decrypt the stored Originality Reports session.");
  }
}
