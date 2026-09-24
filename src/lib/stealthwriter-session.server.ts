/*
 * Server-only primitives for the StealthWriter authorised-session vault.
 *
 * The reference admin flow uses exactly two Better Auth cookie values.
 * Keep the values opaque: validate the container, preserve the cookie values
 * byte-for-byte, encrypt at rest, and never expose decrypted state to a client.
 */
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export const STEALTHWRITER_SESSION_KEYS = [
  "__Secure-better-auth.session_token",
  "__Secure-better-auth.session_data",
] as const;

const AAD = Buffer.from(
  "topratedseotools:stealthwriter:better_auth_cookie_json:v1",
  "utf8",
);

export function normaliseStealthWriterSession(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "Paste the StealthWriter session as the exact two-cookie JSON object shown in the admin guide.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The StealthWriter session must be a JSON object.");
  }

  const source = parsed as Record<string, unknown>;
  const keys = Object.keys(source);
  const unexpected = keys.filter(
    (key) => !(STEALTHWRITER_SESSION_KEYS as readonly string[]).includes(key),
  );
  if (unexpected.length > 0 || keys.length !== STEALTHWRITER_SESSION_KEYS.length) {
    throw new Error(
      "Paste only the two authorised StealthWriter session values shown in the admin guide.",
    );
  }

  const clean: Record<string, string> = {};
  for (const key of STEALTHWRITER_SESSION_KEYS) {
    const value = source[key];
    if (typeof value !== "string" || value.length < 1 || value.length > 32000) {
      throw new Error(`Missing or invalid session value for ${key}.`);
    }
    if (/PASTE_(TOKEN|DATA)_VALUE_HERE/i.test(value)) {
      throw new Error(
        "Replace the placeholder values with the authorised StealthWriter session values first.",
      );
    }
    // Do not trim or transform cookie values. The developer reference flow
    // copies their values exactly from the authorised StealthWriter browser.
    clean[key] = value;
  }
  return JSON.stringify(clean);
}

function decodeEncryptionKey(rawInput?: string): Buffer {
  const raw = String(
    rawInput ?? process.env.STEALTHWRITER_SESSION_ENCRYPTION_KEY ?? "",
  ).trim();

  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");

    if (key.length !== 32) {
      throw new Error(
        "StealthWriter session encryption key must decode to exactly 32 bytes.",
      );
    }
    return key;
  }

  // Lovable Cloud already injects SUPABASE_SERVICE_ROLE_KEY server-side.
  // When a dedicated StealthWriter key is not configured, derive an isolated
  // 32-byte encryption key from that existing secret. HKDF domain separation
  // means the derived key is not the service-role key itself.
  const serviceRoleKey = String(
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  ).trim();
  if (!serviceRoleKey) {
    throw new Error(
      "StealthWriter session encryption is not configured on the server.",
    );
  }

  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(serviceRoleKey, "utf8"),
      Buffer.from("topratedseotools", "utf8"),
      Buffer.from("stealthwriter-session-encryption:v1", "utf8"),
      32,
    ),
  );
}

export function encryptStealthWriterSession(
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

export function decryptStealthWriterSession(
  envelope: string,
  keyMaterial?: string,
): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    throw new Error("Invalid StealthWriter session ciphertext.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid StealthWriter session ciphertext.");
  }

  const value = parsed as Record<string, unknown>;
  if (
    value.v !== 1 ||
    value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ct !== "string"
  ) {
    throw new Error("Invalid StealthWriter session ciphertext.");
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
    throw new Error("Could not decrypt the stored StealthWriter session.");
  }
}
