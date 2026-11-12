/*
 * Server-only primitives for the Claude authorised-session vault.
 *
 * Validates claude.ai cookie bundles, encrypts them at rest (AES-256-GCM,
 * key derived separately from the ChatGPT vault) and never exposes decrypted
 * values to a client.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const AAD = Buffer.from("topratedseotools:claude:session_state_json:v1", "utf8");

type JsonMap = Record<string, string>;

export type ClaudeStoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};

export type ClaudeSessionState = {
  version: 2;
  cookies: ClaudeStoredCookie[];
  session_tokens: {
    storage: {
      localStorage: JsonMap;
      sessionStorage: JsonMap;
    };
  };
};

function isClaudeCookieDomain(raw: string): boolean {
  const host = raw.trim().toLowerCase().replace(/^\./, "");
  return host === "claude.ai" || host.endsWith(".claude.ai");
}

function cleanStorageMap(value: unknown, label: string): JsonMap {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object of string values.`);
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 300) {
    throw new Error(`${label} contains too many entries.`);
  }

  const out: JsonMap = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 512 || typeof item !== "string" || item.length > 128000) {
      throw new Error(`Invalid ${label} entry.`);
    }
    out[key] = item;
  }
  return out;
}

function isIgnoredCookieName(name: string) {
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
      "cf_clearance",
      "__cf_bm",
      "_cfuvid",
    ].includes(lower) ||
    lower.startsWith("intercom-") ||
    lower.startsWith("hubspot") ||
    lower.startsWith("ajs_") ||
    lower.startsWith("amplitude")
  );
}

function cleanCookies(value: unknown): ClaudeStoredCookie[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error(
      "Claude session JSON must include at least one first-party authenticated cookie.",
    );
  }
  if (value.length > 150) {
    throw new Error("Claude session data contains too many cookies.");
  }

  const cookies: ClaudeStoredCookie[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Each Claude cookie must be a JSON object.");
    }

    const source = raw as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const cookieValue = typeof source.value === "string" ? source.value : "";
    const domain =
      typeof source.domain === "string" && source.domain.trim() ? source.domain.trim() : "";
    const path = typeof source.path === "string" && source.path.startsWith("/") ? source.path : "/";

    if (!name || name.length > 256 || cookieValue.length < 1 || cookieValue.length > 128000) {
      throw new Error("Claude session contains a missing or invalid cookie name/value.");
    }
    if (!domain || !isClaudeCookieDomain(domain)) {
      throw new Error(`Refusing to store cookie "${name}" because its domain is not claude.ai.`);
    }

    // The vault stores reusable first-party application state only.
    // Analytics/support cookies and Cloudflare challenge state are excluded.
    if (isIgnoredCookieName(name)) continue;

    const cookie: ClaudeStoredCookie = {
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
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[;\r\n\x00]/.test(cookieValue)) {
      throw new Error("Invalid Claude cookie characters.");
    }
    cookies.push(cookie);
  }

  if (!cookies.length) {
    throw new Error("No reusable first-party Claude session cookies remained after validation.");
  }
  if (
    !cookies.some(
      (c) =>
        c.name === "sessionKey" && (!c.expires || c.expires < 0 || c.expires * 1000 > Date.now()),
    )
  ) {
    throw new Error("The Claude bundle must contain a current sessionKey cookie.");
  }
  return cookies;
}

export function normaliseClaudeSession(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Paste the authorised Claude session JSON first.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("The Claude authorised session must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The Claude authorised session must be a JSON object.");
  }

  const source = parsed as Record<string, unknown>;
  const cookies = cleanCookies(source.authenticated_cookies ?? source.cookies);

  const legacyStorage =
    source.session_tokens &&
    typeof source.session_tokens === "object" &&
    !Array.isArray(source.session_tokens)
      ? (source.session_tokens as Record<string, unknown>).storage
      : undefined;

  const storageSource =
    legacyStorage && typeof legacyStorage === "object" && !Array.isArray(legacyStorage)
      ? (legacyStorage as Record<string, unknown>)
      : source.storage && typeof source.storage === "object" && !Array.isArray(source.storage)
        ? (source.storage as Record<string, unknown>)
        : source;

  const clean: ClaudeSessionState = {
    version: 2,
    cookies,
    session_tokens: {
      storage: {
        localStorage: cleanStorageMap(storageSource.localStorage, "Claude localStorage"),
        sessionStorage: cleanStorageMap(storageSource.sessionStorage, "Claude sessionStorage"),
      },
    },
  };

  return JSON.stringify(clean);
}

function decodeEncryptionKey(rawInput?: string): Buffer {
  const raw = String(rawInput ?? process.env.CLAUDE_SESSION_ENCRYPTION_KEY ?? "").trim();

  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("Claude session encryption key must decode to exactly 32 bytes.");
    }
    return key;
  }

  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!serviceRoleKey) {
    throw new Error("Claude session encryption is not configured on the server.");
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serviceRoleKey, "utf8"),
      Buffer.from("topratedseotools", "utf8"),
      Buffer.from("claude-session-encryption:v1", "utf8"),
      32,
    ),
  );
}

export function encryptClaudeSession(plaintext: string, keyMaterial?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decodeEncryptionKey(keyMaterial), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return JSON.stringify({
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ciphertext.toString("base64"),
  });
}

export function decryptClaudeSession(envelope: string, keyMaterial?: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("Invalid Claude session ciphertext.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Claude session ciphertext.");
  }

  const value = parsed as Record<string, unknown>;
  if (
    value.v !== 1 ||
    value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ct !== "string"
  ) {
    throw new Error("Invalid Claude session ciphertext.");
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
      decipher.update(Buffer.from(value.ct, "base64")).toString("utf8") + decipher.final("utf8")
    );
  } catch {
    throw new Error("Could not decrypt the stored Claude session.");
  }
}
