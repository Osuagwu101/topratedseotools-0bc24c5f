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

export const CHATGPT_SESSION_COOKIE = "__Secure-next-auth.session-token";
export const CHATGPT_SESSION_CHUNK_PREFIX = CHATGPT_SESSION_COOKIE + ".";
export const CHATGPT_SUPPORTING_COOKIE_NAMES = [
  "__Host-next-auth.csrf-token",
  "__Secure-next-auth.callback-url",
  "__Secure-oai-is",
  "_account",
  "_puid",
  "_uasid",
  "_umsid",
  "oai-did",
  "oai-sc",
  "oai_client_auth_info",
  "oai-client-auth-info",
  "oai-client-session-epoch",
  "oai-hlib",
  "__oailb",
] as const;

function isChatGptSessionDomain(raw: string): boolean {
  const host = raw.trim().toLowerCase().replace(/^\./, "");
  return host === "chatgpt.com" || host.endsWith(".chatgpt.com");
}

function isAllowedAuthCookieName(name: string): boolean {
  return (
    name === CHATGPT_SESSION_COOKIE ||
    /^__Secure-next-auth\.session-token\.\d+$/.test(name) ||
    (CHATGPT_SUPPORTING_COOKIE_NAMES as readonly string[]).includes(name)
  );
}

function validateSessionTokenStructure(cookies: ChatGptStoredCookie[]) {
  const byName = new Map(cookies.map((cookie) => [cookie.name, cookie]));
  const unchunked = byName.get(CHATGPT_SESSION_COOKIE);
  const chunks = cookies
    .map((cookie) => {
      const match = cookie.name.match(
        /^__Secure-next-auth\.session-token\.(\d+)$/,
      );
      return match ? { index: Number(match[1]), cookie } : null;
    })
    .filter(
      (
        value,
      ): value is { index: number; cookie: ChatGptStoredCookie } =>
        value !== null,
    )
    .sort((a, b) => a.index - b.index);

  if (unchunked && chunks.length > 0) {
    throw new Error(
      "ChatGPT session contains both unchunked and chunked session-token cookies. Save one format only.",
    );
  }

  if (!unchunked && chunks.length === 0) {
    throw new Error(
      "Missing ChatGPT session token. Include __Secure-next-auth.session-token or the complete .0, .1, ... chunk set.",
    );
  }

  if (chunks.length > 0) {
    if (chunks.length < 2 || chunks[0]?.index !== 0) {
      throw new Error(
        "Incomplete ChatGPT session-token chunks. A chunked session must start at .0 and include the complete sequence.",
      );
    }
    for (let index = 0; index < chunks.length; index += 1) {
      if (chunks[index]?.index !== index) {
        throw new Error(
          `Incomplete ChatGPT session-token chunks. Missing .${index}.`,
        );
      }
    }
  }
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

  const kept: ChatGptStoredCookie[] = [];
  const names = new Set<string>();

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }

    const source = raw as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!isAllowedAuthCookieName(name)) continue;

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
      !cookieValue ||
      cookieValue.length > 128000 ||
      /[\r\n;]/.test(cookieValue)
    ) {
      throw new Error(`Invalid ChatGPT auth cookie value for ${name}.`);
    }
    if (!domain || !isChatGptSessionDomain(domain) || cookiePath !== "/") {
      throw new Error(
        `ChatGPT auth cookie "${name}" must belong to chatgpt.com and use path /.`,
      );
    }
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
    kept.push(cookie);
  }

  validateSessionTokenStructure(kept);

  const sessionCookies = kept
    .filter(
      (cookie) =>
        cookie.name === CHATGPT_SESSION_COOKIE ||
        cookie.name.startsWith(CHATGPT_SESSION_CHUNK_PREFIX),
    )
    .sort((a, b) => {
      if (a.name === CHATGPT_SESSION_COOKIE) return -1;
      if (b.name === CHATGPT_SESSION_COOKIE) return 1;
      return (
        Number(a.name.slice(CHATGPT_SESSION_CHUNK_PREFIX.length)) -
        Number(b.name.slice(CHATGPT_SESSION_CHUNK_PREFIX.length))
      );
    });

  const supportingCookies = CHATGPT_SUPPORTING_COOKIE_NAMES.flatMap((name) => {
    const cookie = kept.find((candidate) => candidate.name === name);
    return cookie ? [cookie] : [];
  });

  return [...sessionCookies, ...supportingCookies];
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
