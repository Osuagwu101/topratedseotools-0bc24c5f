import { createHmac, timingSafeEqual } from "node:crypto";

function sidSignature(sid, writer, doc, key) {
  return createHmac("sha256", key).update(JSON.stringify(["grammarly-coda-sid-v1", writer, doc, sid])).digest("base64url");
}
export function sealCodaSid(sid, writer, doc, key) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sid) || !key) throw new Error("Invalid Coda session");
  return sid + "~" + sidSignature(sid, writer, doc, key);
}
export function openCodaSid(value, writer, doc, key) {
  if (!key || typeof value !== "string") return null;
  const match = value.match(/^([A-Za-z0-9_-]{1,100})~([A-Za-z0-9_-]{43})$/);
  if (!match) return null;
  const expected = Buffer.from(sidSignature(match[1], writer, doc, key));
  const supplied = Buffer.from(match[2]);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied) ? match[1] : null;
}
export function sealCodaHandshake(text, writer, doc, key) {
  return String(text).split("\x1e").map(packet => {
    if (!packet.startsWith("0{")) return packet;
    try {
      const data = JSON.parse(packet.slice(1));
      if (typeof data.sid !== "string") return packet;
      data.sid = sealCodaSid(data.sid, writer, doc, key);
      return "0" + JSON.stringify(data);
    } catch { throw new Error("Invalid Coda handshake"); }
  }).join("\x1e");
}
