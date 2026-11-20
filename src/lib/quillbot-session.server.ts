/*
 * Server-only primitives for the QuillBot authorised-session vault.
 *
 * The isolated feasibility flow uses an opaque Cookie header and Useridtoken.
 * Keep the values opaque: validate the container, preserve the cookie values
 * byte-for-byte, encrypt at rest, and never expose decrypted state to a client.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const QUILLBOT_SESSION_KEYS = [
  "cookie",
  "useridtoken",
] as const;

/** Optional: QuillBot's Firebase sign-in record, which holds the long-lived refresh token. */
export const QUILLBOT_FIREBASE_KEY = "firebase_auth";
export const QUILLBOT_EXPORT_SOURCE = "trst-quillbot-export";

/**
 * Validate the Firebase sign-in record captured by the export snippet and
 * return it in a canonical form: {store, key, value}. The refresh token inside
 * lets the server browser renew QuillBot's 1-hour useridtoken by itself.
 */
export function normaliseQuillBotFirebaseAuth(raw: unknown): string {
  let parsed: any = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { throw new Error("The QuillBot sign-in record is not valid JSON."); }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid QuillBot sign-in record.");
  const key = parsed.key;
  const store = parsed.store === "localStorage" ? "localStorage" : "indexedDB";
  let value = parsed.value;
  if (typeof value === "string") { try { value = JSON.parse(value); } catch { throw new Error("Invalid QuillBot sign-in record."); } }
  if (typeof key !== "string" || !/^firebase:authUser:[A-Za-z0-9_-]{10,80}:\[DEFAULT\]$/.test(key)) {
    throw new Error("The QuillBot sign-in record has an unexpected key.");
  }
  const refresh = value?.stsTokenManager?.refreshToken;
  if (!value || typeof value !== "object" || typeof refresh !== "string" || refresh.length < 20 || refresh.length > 4000) {
    throw new Error("The QuillBot sign-in record does not contain a refresh token. Sign in to QuillBot and export again.");
  }
  const out = JSON.stringify({ store, key, value });
  if (out.length > 32000) throw new Error("The QuillBot sign-in record is too large.");
  return out;
}

/** True when a normalised session carries a refresh token, so an expired useridtoken is acceptable. */
export function quillBotSessionRenewable(plaintext: string): boolean {
  try { return typeof JSON.parse(plaintext)[QUILLBOT_FIREBASE_KEY] === "string"; } catch { return false; }
}

const AAD = Buffer.from(
  "topratedseotools:quillbot:authorised_session_json:v1",
  "utf8",
);

export function normaliseQuillBotSession(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Paste the two-field QuillBot authorised session JSON object.",
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("The QuillBot session must be a JSON object.");
  }

  // Export-snippet format: cookies + useridtoken + Firebase sign-in record.
  let firebase: string | null = null;
  const snippet = parsed as any;
  if (snippet && !Array.isArray(snippet) && snippet.source === QUILLBOT_EXPORT_SOURCE) {
    firebase = normaliseQuillBotFirebaseAuth(snippet[QUILLBOT_FIREBASE_KEY]);
    const record = JSON.parse(firebase);
    const token = typeof snippet.useridtoken === "string" && snippet.useridtoken.length > 100
      ? snippet.useridtoken
      : record.value?.stsTokenManager?.accessToken;
    if (typeof token !== "string" || token.length < 100) throw new Error("The QuillBot export is missing its sign-in token.");
    const cookie = String(snippet.cookie ?? "").split(";").map((v: string) => v.trim())
      .filter((v: string) => v.includes("=") && !/^(cf_clearance|__cf_bm|_cfuvid|useridtoken)=/.test(v));
    cookie.push("useridtoken=" + encodeURIComponent(token));
    parsed = { cookie: cookie.join("; "), useridtoken: token };
  } else if (snippet && !Array.isArray(snippet) && QUILLBOT_FIREBASE_KEY in snippet) {
    // Already-normalised stored state that carries a sign-in record.
    firebase = normaliseQuillBotFirebaseAuth(snippet[QUILLBOT_FIREBASE_KEY]);
    const { [QUILLBOT_FIREBASE_KEY]: _omit, ...rest } = snippet;
    parsed = rest;
  }

  // Application cookie exports are normalised to the existing encrypted wire format.
  const exported = Array.isArray(parsed) ? parsed : (parsed as any)?.cookies;
  if(Array.isArray(exported)) {
    const cookies = exported.filter((c:any)=>c && typeof c.name === "string" && typeof c.value === "string" && typeof c.domain === "string" && /(?:^|\.)quillbot\.com$/.test(c.domain.replace(/^\./,"")) && !["cf_clearance","__cf_bm","_cfuvid"].includes(c.name));
    const token=cookies.find((c:any)=>c.name === "useridtoken")?.value;
    if(!token)throw Error("The QuillBot cookie export must include useridtoken.");
    parsed={cookie:cookies.map((c:any)=>c.name+"="+c.value).join("; "),useridtoken:token};
  } else if(parsed && typeof parsed === "object" && !("cookie" in parsed)) {
    const values=parsed as Record<string,unknown>;
    if(typeof values.useridtoken !== "string")throw Error("Include useridtoken from Application cookies.");
    if(Object.values(values).some(v=>typeof v!=="string"))throw Error("Cookie values must be strings.");
    parsed={cookie:Object.entries(values).filter(([n])=>!["cf_clearance","__cf_bm","_cfuvid"].includes(n)).map(([n,v])=>n+"="+v).join("; "),useridtoken:values.useridtoken};
  }
  const source = parsed as Record<string, unknown>;
  const keys = Object.keys(source);
  const unexpected = keys.filter(
    (key) => !(QUILLBOT_SESSION_KEYS as readonly string[]).includes(key),
  );
  if (unexpected.length > 0 || keys.length !== QUILLBOT_SESSION_KEYS.length) {
    throw new Error(
      "Paste only the Cookie and Useridtoken values.",
    );
  }

  const clean: Record<string, string> = {};
  for (const key of QUILLBOT_SESSION_KEYS) {
    const value = source[key];
    if (typeof value !== "string" || value.length < 1 || value.length > 32000) {
      throw new Error(`Missing or invalid session value for ${key}.`);
    }
    if (/[\r\n\0]/.test(value)) {
      throw new Error("Session header values must not contain control characters.");
    }
    if (/PASTE_(TOKEN|DATA)_VALUE_HERE/i.test(value)) {
      throw new Error(
        "Replace the placeholder values with the authorised QuillBot session values first.",
      );
    }
    // Do not trim or transform cookie values. The developer reference flow
    // preserves values exactly from an authorised QuillBot browser.
    clean[key] = value;
  }
  if (firebase) clean[QUILLBOT_FIREBASE_KEY] = firebase;
  return JSON.stringify(clean);
}

/**
 * Read the exported ID token's expiry as a freshness hint only.
 * This does not verify its signature or grant access; upstream authentication
 * remains authoritative. Opaque provider token formats remain supported.
 */
export function quillBotSessionExpiry(useridtoken: string, nowMs = Date.now()) {
  try {
    const parts = useridtoken.split(".");
    if (parts.length !== 3) return { expiresAt: null, expired: null };
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const seconds = payload.exp;
    if (typeof seconds !== "number" || !Number.isFinite(seconds)) return { expiresAt: null, expired: null };
    const date = new Date(seconds * 1000);
    if (!Number.isFinite(date.getTime())) return { expiresAt: null, expired: null };
    return { expiresAt: date.toISOString(), expired: date.getTime() <= nowMs };
  } catch {
    return { expiresAt: null, expired: null };
  }
}

function decodeEncryptionKey(rawInput?: string): Buffer {
  const raw = String(
    rawInput ?? process.env.QUILLBOT_SESSION_ENCRYPTION_KEY ?? "",
  ).trim();

  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");

    if (key.length !== 32) {
      throw new Error(
        "QuillBot session encryption key must decode to exactly 32 bytes.",
      );
    }
    return key;
  }

  // Fallback HKDF key is domain-separated from the StealthWriter encryption key.
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (!serviceRoleKey) {
    throw new Error(
      "QuillBot session encryption is not configured on the server.",
    );
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serviceRoleKey, "utf8"),
      Buffer.from("topratedseotools", "utf8"),
      Buffer.from("quillbot-session-encryption:v1", "utf8"),
      32,
    ),
  );
}

export function encryptQuillBotSession(
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

export function decryptQuillBotSession(
  envelope: string,
  keyMaterial?: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("Invalid QuillBot session ciphertext.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid QuillBot session ciphertext.");
  }

  const value = parsed as Record<string, unknown>;
  if (
    value.v !== 1 ||
    value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ct !== "string"
  ) {
    throw new Error("Invalid QuillBot session ciphertext.");
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
    throw new Error("Could not decrypt the stored QuillBot session.");
  }
}
