import { describe, it, expect } from "vitest";
import { SECRET_KEY_PREFIX, decodePublicKeyBytes, decodeSecretKeyString, derivePublicKeyBytes, encodeSecretKey, generateSecretKey, signBase64Url, verifyBase64UrlSignature } from "./ed5519";
import { bytesToBase64Url, textToBytes } from "./base64url";

function fixedSeed(n: number): Uint8Array {
  const seed = new Uint8Array(32);
  seed[31] = n;
  return seed;
}

describe("keys", () => {
  it("generateSecretKey returns 32 fresh bytes", () => {
    const a = generateSecretKey();
    const b = generateSecretKey();
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    // two 32-byte random keys differ with overwhelming probability
    expect(a.some((byte, i) => byte !== b[i])).toBe(true);
  });

  it("encodeSecretKey is npk_-prefixed base64url of the seed", () => {
    const seed = fixedSeed(7);
    const encoded = encodeSecretKey(seed);
    expect(encoded.startsWith(SECRET_KEY_PREFIX)).toBe(true);
    expect(encoded).toBe(SECRET_KEY_PREFIX + bytesToBase64Url(seed));
  });

  it("decodeSecretKeyString round-trips and validates", () => {
    const seed = fixedSeed(1);
    expect(decodeSecretKeyString(encodeSecretKey(seed))).toEqual(seed);
    expect(() => decodeSecretKeyString("npk_" + "AA")).toThrow(/32 bytes/);
    expect(() => decodeSecretKeyString("aQID-base64url-no-prefix")).toThrow(/npk_ prefix/);
  });

  it("derivePublicKeyBytes is deterministic and 32 bytes", () => {
    expect(derivePublicKeyBytes(fixedSeed(9))).toEqual(derivePublicKeyBytes(fixedSeed(9)));
    expect(derivePublicKeyBytes(fixedSeed(9)).length).toBe(32);
    expect(() => derivePublicKeyBytes(new Uint8Array(31))).toThrow(/length/);
  });

  it("decodePublicKeyBytes accepts exactly base64url 32-byte keys", () => {
    const pub = derivePublicKeyBytes(fixedSeed(3));
    expect(decodePublicKeyBytes(bytesToBase64Url(pub))).toEqual(pub);
    expect(() => decodePublicKeyBytes(bytesToBase64Url(new Uint8Array(31)))).toThrow(/32 bytes/);
  });
});

describe("sign / verify", () => {
  it("round-trips for several messages", () => {
    const seed = fixedSeed(11);
    const pub = bytesToBase64Url(derivePublicKeyBytes(seed));
    const messages: Uint8Array[] = [
      new Uint8Array([]),
      textToBytes("nporkerd-login:challengeid:nonce"),
      textToBytes("héllo, wörld ✓"),
    ];
    for (const m of messages) {
      const sig = signBase64Url(m, seed);
      expect(verifyBase64UrlSignature(sig, m, pub)).toBe(true);
    }
  });

  it("rejects a tampered message", () => {
    const seed = fixedSeed(11);
    const pub = bytesToBase64Url(derivePublicKeyBytes(seed));
    const m = textToBytes("nporkerd-login:challengeid:nonce");
    const sig = signBase64Url(m, seed);
    const tampered = textToBytes("nporkerd-login:challengeid:noncd");
    expect(verifyBase64UrlSignature(sig, tampered, pub)).toBe(false);
  });

  it("rejects a wrong public key", () => {
    const seed = fixedSeed(11);
    const otherPub = bytesToBase64Url(derivePublicKeyBytes(fixedSeed(12)));
    const m = textToBytes("nonce-bytes");
    const sig = signBase64Url(m, seed);
    expect(verifyBase64UrlSignature(sig, m, otherPub)).toBe(false);
  });

  it("rejects a corrupted signature without throwing", () => {
    const seed = fixedSeed(11);
    const pub = bytesToBase64Url(derivePublicKeyBytes(seed));
    const m = textToBytes("nonce-bytes");
    const sig = signBase64Url(m, seed);
    const corrupted = (sig[0] === "B" ? "A" : "B") + sig.slice(1);
    expect(verifyBase64UrlSignature(corrupted, m, pub)).toBe(false);
    // garbage that is not even valid base64url must also just return false
    expect(verifyBase64UrlSignature("!!!", m, pub)).toBe(false);
  });

  it("a real signature verifies only for its own key (determinism)", () => {
    const seed = fixedSeed(5);
    const m = textToBytes("same-message");
    const s1 = signBase64Url(m, seed);
    const s2 = signBase64Url(m, seed);
    expect(s1).toBe(s2);
    expect(verifyBase64UrlSignature(s1, m, bytesToBase64Url(derivePublicKeyBytes(seed)))).toBe(true);
  });
});
