/*
 * Server-only primitives for the Phrasly authorised-session vault.
 *
 * Phrasly reuses first-party phrasly.ai cookies plus browser storage state.
 * Keep every value opaque, validate only the container/domain boundaries,
 * encrypt at rest, and never expose decrypted state to a client.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

const AAD = Buffer.from(
  "topratedseotools:phrasly:session_state_json:v1",
  "utf8",
);

type JsonMap = Record<string, string>;

export const PHRASLY_AUTH_COOKIE_NAME = "session";

export type PhraslyStoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};

export type PhraslySessionState = {
  authenticated_cookies: PhraslyStoredCookie[];
  session_tokens: {
    storage: {
      localStorage: JsonMap;
      sessionStorage: JsonMap;
    };
  };
};

function isPhraslyCookieDomain(raw: string): boolean {
  const host = raw.trim().toLowerCase().replace(/^\./, "");
  return host === "phrasly.ai" || host.endsWith(".phrasly.ai");
}

function cleanStorageMap(value: unknown, label: string): JsonMap {
  if (value == null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object of string values.`);
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 250) {
    throw new Error(`${label} contains too many entries.`);
  }

  const out: JsonMap = {};
  for (const [key, item] of entries) {
    if (!key || key.length > 512 || typeof item !== "string" || item.length > 64000) {
      throw new Error(`Invalid ${label} entry.`);
    }
    out[key] = item;
  }
  return out;
}

function isIgnoredPhraslyCookieName(name: string) {
  const lower = name.toLowerCase();
  return (
    /^(_ga|_gid|_gat|_utm)/.test(lower) ||
    ["_fbp", "_fbc", "_clck", "_clsk", "_uetmsclkid", "_uetsid", "_uetvid", "_ttp", "cf_clearance", "__cf_bm"].includes(lower) ||
    lower.startsWith("intercom-") ||
    lower.startsWith("hubspot") ||
    lower.startsWith("ajs_") ||
    lower.startsWith("amplitude")
  );
}

function cleanCookies(value: unknown): PhraslyStoredCookie[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error(
      'Phrasly session data must include the first-party "session" cookie.',
    );
  }
  if (value.length > 100) {
    throw new Error("Phrasly session data contains too many cookies.");
  }

  const cookies: PhraslyStoredCookie[] = [];
  let hasRootSessionCookie = false;

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Each Phrasly cookie must be a JSON object.");
    }
    const source = raw as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const cookieValue = typeof source.value === "string" ? source.value : "";
    const domain =
      typeof source.domain === "string" && source.domain.trim()
        ? source.domain.trim()
        : ".phrasly.ai";
    const path =
      typeof source.path === "string" && source.path.startsWith("/")
        ? source.path
        : "/";

    if (!name || name.length > 256 || cookieValue.length < 1 || cookieValue.length > 64000) {
      throw new Error("Phrasly session contains a missing or invalid cookie name/value.");
    }
    if (!isPhraslyCookieDomain(domain)) {
      throw new Error(
        `Refusing to store cookie "${name}" because its domain is not phrasly.ai.`,
      );
    }

    // Keep only reusable first-party application state. Tracking/support
    // cookies and Cloudflare challenge cookies are intentionally excluded.
    if (isIgnoredPhraslyCookieName(name)) continue;

    const normalisedDomain = domain.toLowerCase().replace(/^\./, "");
    if (name === PHRASLY_AUTH_COOKIE_NAME) {
      if (normalisedDomain !== "phrasly.ai" || path !== "/") {
        throw new Error(
          'The Phrasly "session" cookie must belong to phrasly.ai with path "/".',
        );
      }
      hasRootSessionCookie = true;
    }

    const cookie: PhraslyStoredCookie = {
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
    cookies.push(cookie);
  }

  if (!hasRootSessionCookie) {
    throw new Error(
      'No Phrasly login cookie was found. Copy the "session" cookie from phrasly.ai.',
    );
  }

  // Stable order keeps the primary auth cookie first while preserving the
  // remaining first-party cookie order from the browser export.
  return cookies.sort((a, b) =>
    a.name === PHRASLY_AUTH_COOKIE_NAME
      ? -1
      : b.name === PHRASLY_AUTH_COOKIE_NAME
        ? 1
        : 0,
  );
}

export function normalisePhraslySession(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('Paste the Phrasly "session" cookie value first.');
  }

  // Admin quick-paste: Chrome DevTools exposes the Phrasly login as one
  // first-party cookie named "session". Accept either its bare value or a
  // session=<value> cookie pair and wrap it into the canonical encrypted shape.
  if (!trimmed.startsWith("{")) {
    const cookieValue = trimmed.startsWith(`${PHRASLY_AUTH_COOKIE_NAME}=`)
      ? trimmed.slice(PHRASLY_AUTH_COOKIE_NAME.length + 1)
      : trimmed;
    if (
      !cookieValue ||
      cookieValue.length > 64000 ||
      /[\r\n;]/.test(cookieValue)
    ) {
      throw new Error('The Phrasly "session" cookie value is invalid.');
    }
    return JSON.stringify({
      authenticated_cookies: [
        {
          name: PHRASLY_AUTH_COOKIE_NAME,
          value: cookieValue,
          domain: ".phrasly.ai",
          path: "/",
          secure: true,
          httpOnly: true,
          sameSite: "Lax",
        },
      ],
      session_tokens: {
        storage: {
          localStorage: {},
          sessionStorage: {},
        },
      },
    } satisfies PhraslySessionState);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      'Paste either the Phrasly "session" cookie value or valid session JSON.',
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The Phrasly authorised session must be a JSON object.");
  }

  const source = parsed as Record<string, unknown>;
  const cookies = cleanCookies(
    source.authenticated_cookies ?? source.cookies,
  );

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

  const localStorage = cleanStorageMap(
    storageSource.localStorage,
    "Phrasly localStorage",
  );
  const sessionStorage = cleanStorageMap(
    storageSource.sessionStorage,
    "Phrasly sessionStorage",
  );

  const clean: PhraslySessionState = {
    authenticated_cookies: cookies,
    session_tokens: {
      storage: {
        localStorage,
        sessionStorage,
      },
    },
  };

  return JSON.stringify(clean);
}

function decodeEncryptionKey(rawInput?: string): Buffer {
  const raw = String(
    rawInput ?? process.env.PHRASLY_SESSION_ENCRYPTION_KEY ?? "",
  ).trim();

  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");

    if (key.length !== 32) {
      throw new Error(
        "Phrasly session encryption key must decode to exactly 32 bytes.",
      );
    }
    return key;
  }

  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (!serviceRoleKey) {
    throw new Error(
      "Phrasly session encryption is not configured on the server.",
    );
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serviceRoleKey, "utf8"),
      Buffer.from("topratedseotools", "utf8"),
      Buffer.from("phrasly-session-encryption:v1", "utf8"),
      32,
    ),
  );
}

export function encryptPhraslySession(
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

export function decryptPhraslySession(
  envelope: string,
  keyMaterial?: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("Invalid Phrasly session ciphertext.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Phrasly session ciphertext.");
  }

  const value = parsed as Record<string, unknown>;
  if (
    value.v !== 1 ||
    value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ct !== "string"
  ) {
    throw new Error("Invalid Phrasly session ciphertext.");
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
    throw new Error("Could not decrypt the stored Phrasly session.");
  }
}
