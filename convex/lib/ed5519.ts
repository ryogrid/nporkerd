// Shared Ed25519 wiring (design/03 §1): `@noble/ed25519` needs a synchronous
// SHA-512 provider before any sync sign/verify call. Importing THIS module
// performs that wiring exactly once per runtime (server and client each import
// it), so it must be imported before using the sync helpers.
import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { base64UrlToBytes, bytesToBase64Url } from "./base64url";

ed.hashes.sha512 = sha512; // enables sync getPublicKey/sign/verify (03 §1)

// Key/token string forms (design/03 §2): private keys are `npk_`-prefixed
// base64url of the 32-byte seed; public keys are plain base64url.
export const SECRET_KEY_PREFIX = "npk_";

export function generateSecretKey(): Uint8Array {
  return ed.utils.randomSecretKey();
}

export function derivePublicKeyBytes(seed: Uint8Array): Uint8Array {
  if (seed.length !== 32) throw new Error("bad secret key length");
  return ed.getPublicKey(seed);
}

export function encodeSecretKey(seed: Uint8Array): string {
  return SECRET_KEY_PREFIX + bytesToBase64Url(seed);
}

export function decodeSecretKeyString(key: string): Uint8Array {
  if (!key.startsWith(SECRET_KEY_PREFIX)) throw new Error("missing npk_ prefix");
  const bytes = base64UrlToBytes(key.slice(SECRET_KEY_PREFIX.length));
  if (bytes.length !== 32) throw new Error("secret key must decode to 32 bytes");
  return bytes;
}

export function decodePublicKeyBytes(publicKey: string): Uint8Array {
  const bytes = base64UrlToBytes(publicKey);
  if (bytes.length !== 32) throw new Error("public key must decode to 32 bytes");
  return bytes;
}

// Login response: client signs the server nonce; server verifies. Both
// directions use base64url signatures (design/03 §2).
export function signBase64Url(message: Uint8Array, secretKeySeed: Uint8Array): string {
  return bytesToBase64Url(ed.sign(message, secretKeySeed));
}

export function verifyBase64UrlSignature(
  signature: string,
  message: Uint8Array,
  publicKey: string,
): boolean {
  try {
    return ed.verify(base64UrlToBytes(signature), message, decodePublicKeyBytes(publicKey));
  } catch {
    return false;
  }
}

// Fingerprints for the UI (design/03 §2): first 10 hex of SHA-256 — computed
// with a plain non-crypto mixer? No: the UI calls hash.sha256Hex; this module
// only exposes key primitives. (kept out to avoid async deps here.)
