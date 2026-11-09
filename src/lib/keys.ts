// Client-side Ed25519 + key-file handling — design/03 §2–§4, design/07 §2.1–2.2
// and 07 §4 (`lib/keys.ts`). Everything here runs in the browser: the private
// key is generated, shown and signed in memory only, never persisted by the
// app (03 §3 last paragraph; the downloaded file is the user's own store).
//
// `@noble/ed25519` needs a synchronous SHA-512 before any sync call, so the
// wiring below happens exactly once on import (same as convex/lib/ed5519.ts).
import * as ed from "@noble/ed25519";
import { sha512, sha256 } from "@noble/hashes/sha2.js";

ed.hashes.sha512 = sha512; // enables sync getPublicKey/sign/verify (03 §1)

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function bytesToBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64_ALPHABET[b0 >> 2];
    if (b1 === undefined) {
      out += B64_ALPHABET[(b0 & 0x03) << 4];
      break;
    }
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (b2 === undefined) {
      out += B64_ALPHABET[(b1 & 0x0f) << 2];
      break;
    }
    out += B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

function base64UrlToBytes(value: string): Uint8Array {
  if (/[+/=]/.test(value)) {
    throw new Error("not base64url");
  }
  const out = new Uint8Array(Math.floor((value.length * 3) / 4));
  let acc = 0;
  let bits = 0;
  let index = 0;
  for (const ch of value) {
    const digit = B64_ALPHABET.indexOf(ch);
    if (digit < 0) {
      throw new Error(`invalid base64url char ${ch}`);
    }
    acc = (acc << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

function textToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

// 03 §2: private keys are `npk_` + base64url of the 32-byte secret key.
export const SECRET_KEY_PREFIX = "npk_";

/** First 10 hex of SHA-256 of the base64url public key — the UI aid (03 §2). */
export function fingerprintOfPublicKey(publicKey: string): string {
  return bytesToHex(sha256(textToBytes(publicKey))).slice(0, 10);
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

/** Generate a fresh account key pair (03 §3 step 2). */
export function generateKeyPair(): { publicKey: string; secretKey: string; fingerprint: string } {
  const secret = ed.utils.randomSecretKey();
  const publicBytes = ed.getPublicKey(secret);
  const publicKey = bytesToBase64Url(publicBytes);
  return {
    publicKey,
    secretKey: SECRET_KEY_PREFIX + bytesToBase64Url(secret),
    fingerprint: fingerprintOfPublicKey(publicKey),
  };
}

export function decodeSecretKey(secretKey: string): Uint8Array {
  if (!secretKey.startsWith(SECRET_KEY_PREFIX)) {
    throw new Error("missing npk_ prefix");
  }
  const bytes = base64UrlToBytes(secretKey.slice(SECRET_KEY_PREFIX.length));
  if (bytes.length !== 32) {
    throw new Error("secret key must decode to 32 bytes");
  }
  return bytes;
}

/** Public key + fingerprint of a pasted private key (07 §2.2, 03 §4.2). */
export function describeSecretKey(secretKey: string): { publicKey: string; fingerprint: string } {
  const secret = decodeSecretKey(secretKey);
  const publicKey = bytesToBase64Url(ed.getPublicKey(secret));
  return { publicKey, fingerprint: fingerprintOfPublicKey(publicKey) };
}

/** Key-file body: username, key, fingerprint, loss warning (03 §3 step 5). */
export function buildKeyFile(username: string, secretKey: string, fingerprint: string): string {
  return [
    "nporkerd account key",
    `username: ${username}`,
    `key: ${secretKey}`,
    `fingerprint: ${fingerprint}`,
    "",
    "This key is your password. It is shown only at registration; if you lose",
    "it this account can never be accessed again and nobody can restore it.",
    "Keep this file somewhere private (your password manager is fine). Anyone",
    "who holds it can log in as you, so never share it.",
    "",
  ].join("\n");
}

/** Pull the `npk_…` token out of pasted text or an uploaded key file. */
export function parseKeyFile(text: string): string | undefined {
  const found = /npk_[A-Za-z0-9_-]+/.exec(text);
  if (found === null) {
    return undefined;
  }
  const token = found[0];
  if (token.length !== SECRET_KEY_PREFIX.length + 43) {
    return undefined;
  }
  return token;
}

/** Sign a login challenge: msg = "nporkerd-login:" + id + ":" + nonce (03 §4.1). */
export function signChallenge(challengeId: string, nonce: string, secretKey: string): string {
  const secret = decodeSecretKey(secretKey);
  const message = textToBytes(`nporkerd-login:${challengeId}:${nonce}`);
  return bytesToBase64Url(ed.sign(message, secret));
}
