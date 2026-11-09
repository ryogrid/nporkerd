// base64url helpers — shared by client and server code (no server-only deps).
// Used for Ed25519 keys, nonces, signatures, session tokens (design/03 §2).

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += ALPHABET[b0 >> 2];
    if (b1 === undefined) {
      out += ALPHABET[(b0 & 0x03) << 4];
      break;
    }
    out += ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += ALPHABET[(b1 & 0x0f) << 2];
      break;
    }
    out += ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += ALPHABET[b2 & 0x3f];
  }
  return out;
}

export function base64UrlToBytes(s: string): Uint8Array {
  const lookup = new Map<string, number>();
  for (let i = 0; i < ALPHABET.length; i++) lookup.set(ALPHABET[i], i);
  if (/[+/=]/.test(s)) throw new Error("not base64url: found +/= character");
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let idx = 0;
  for (const ch of s) {
    const v = lookup.get(ch);
    if (v === undefined) throw new Error(`invalid base64url char ${ch}`);
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[idx++] = (acc >> bits) & 0xff;
    }
  }
  if (s.length % 4 === 1) throw new Error("invalid base64url length");
  return out;
}

export function textToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}
