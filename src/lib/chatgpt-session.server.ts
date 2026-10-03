/*
 * ChatGPT single-account authorised-session vault.
 *
 * Phase 5 follows the working StealthWriter principle:
 * known reusable first-party auth state -> preserve opaque values exactly ->
 * encrypt server-side -> never expose the values to writers.
 *
 * Browser localStorage/sessionStorage is deliberately not part of the v3
 * format. Legacy v2 containers can be normalised into v3 server-side.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const CHATGPT_SESSION_FORMAT = "chatgpt_minimal_cookie_json_v3";

const AAD_V3 = Buffer.from(
  "topratedseotools:chatgpt:minimal_cookie_json:v3",
  "utf8",
);
const LEGACY_AAD_V1 = Buffer.from(
  "topratedseotools:chatgpt:session_state_json:v1",
  "utf8",
);

export type ChatGptStoredCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
};

export type ChatGptSessionState = {
  version: 3;
  cookies: ChatGptStoredCookie[];
};

function isChatGptCookieDomain(raw: string): boolean {
  const host = raw.trim().toLowerCase().replace(/^\./, "");
  return (
    host === "chatgpt.com" ||
    host.endsWith(".chatgpt.com") ||
    host === "openai.com" ||
    host.endsWith(".openai.com")
  );
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

function cleanCookies(value: unknown): ChatGptStoredCookie[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error(
      "ChatGPT session JSON must include the reusable first-party authentication cookies.",
    );
  }
  if (value.length > 48) {
    throw new Error("ChatGPT session data contains too many cookies.");
  }

  const cookies: ChatGptStoredCookie[] = [];
  const names = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Each ChatGPT cookie must be a JSON object.");
    }

    const source = raw as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    const cookieValue = typeof source.value === "string" ? source.value : "";
    const domain =
      typeof source.domain === "string" && source.domain.trim()
        ? source.domain.trim()
        : "";
    const cookiePath =
      typeof source.path === "string" && source.path.startsWith("/")
        ? source.path
        : "/";

    if (
      !name ||
      !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) ||
      cookieValue.length < 1 ||
      cookieValue.length > 128000 ||
      /[\r\n;]/.test(cookieValue)
    ) {
      throw new Error("ChatGPT session contains an invalid cookie name/value.");
    }
    if (!domain || !isChatGptCookieDomain(domain)) {
      throw new Error(
        `Refusing to store cookie "${name}" because its domain is not chatgpt.com/openai.com.`,
      );
    }
    if (isIgnoredCookieName(name)) continue;
    if (names.has(name)) {
      throw new Error(
        `ChatGPT session contains duplicate cookie name "${name}".`,
      );
    }
    names.add(name);

    const cookie: ChatGptStoredCookie = {
      name,
      value: cookieValue,
      domain,
      path: cookiePath,
    };
    if (typeof source.expires === "number" && Number.isFinite(source.expires)) {
      cookie.expires = source.expires;
    }
    cookies.push(cookie);
  }

  if (!cookies.length) {
    throw new Error(
      "No reusable first-party ChatGPT authentication cookies remained after validation.",
    );
  }
  if (cookies.length > 16) {
    throw new Error(
      "Too many reusable ChatGPT cookies remain. Save only the minimal authentication state.",
    );
  }
  return cookies;
}

export function normaliseChatGptSession(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Paste the authorised ChatGPT session JSON first.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("The ChatGPT authorised session must be valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The ChatGPT authorised session must be a JSON object.");
  }

  const source = parsed as Record<string, unknown>;
  const clean: ChatGptSessionState = {
    version: 3,
    cookies: cleanCookies(source.cookies ?? source.authenticated_cookies),
  };

  return JSON.stringify(clean);
}

function decodeEncryptionKey(rawInput?: string): Buffer {
  const raw = String(
    rawInput ?? process.env.CHATGPT_SESSION_ENCRYPTION_KEY ?? "",
  ).trim();

  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error(
        "ChatGPT session encryption key must decode to exactly 32 bytes.",
      );
    }
    return key;
  }

  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (!serviceRoleKey) {
    throw new Error(
      "ChatGPT session encryption is not configured on the server.",
    );
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serviceRoleKey, "utf8"),
      Buffer.from("topratedseotools", "utf8"),
      Buffer.from("chatgpt-session-encryption:v1", "utf8"),
      32,
    ),
  );
}

export function encryptChatGptSession(
  plaintext: string,
  keyMaterial?: string,
): string {
  const normalised = normaliseChatGptSession(plaintext);
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    decodeEncryptionKey(keyMaterial),
    iv,
  );
  cipher.setAAD(AAD_V3);
  const ciphertext = Buffer.concat([
    cipher.update(normalised, "utf8"),
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

function decryptWithAad(
  envelope: Record<string, unknown>,
  key: Buffer,
  aad: Buffer,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(String(envelope.iv), "base64"),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(String(envelope.tag), "base64"));
  return (
    decipher.update(Buffer.from(String(envelope.ct), "base64")).toString("utf8") +
    decipher.final("utf8")
  );
}

export function decryptChatGptSession(
  envelope: string,
  keyMaterial?: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("Invalid ChatGPT session ciphertext.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid ChatGPT session ciphertext.");
  }

  const value = parsed as Record<string, unknown>;
  if (
    value.v !== 1 ||
    value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ct !== "string"
  ) {
    throw new Error("Invalid ChatGPT session ciphertext.");
  }

  const key = decodeEncryptionKey(keyMaterial);
  for (const aad of [AAD_V3, LEGACY_AAD_V1]) {
    try {
      return decryptWithAad(value, key, aad);
    } catch {
      // Try the next known historical AAD.
    }
  }
  throw new Error("Could not decrypt the stored ChatGPT session.");
}

export function migrateChatGptSessionPlaintext(plaintext: string): string {
  return normaliseChatGptSession(plaintext);
}
