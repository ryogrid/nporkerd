import { describe, it, expect } from "vitest";
import { base64UrlToBytes, bytesToBase64Url, textToBytes } from "./base64url";

describe("bytesToBase64Url", () => {
  it("matches base64url (RFC 4648 machine-readable form, unpadded)", () => {
    expect(bytesToBase64Url(new Uint8Array([0, 0, 0]))).toBe("AAAA");
    expect(bytesToBase64Url(textToBytes("Man"))).toBe("TWFu");
    expect(bytesToBase64Url(new Uint8Array([191, 45, 238]))).toBe("vy3u");
    expect(bytesToBase64Url(new Uint8Array([255]))).toBe("_w");
    expect(bytesToBase64Url(new Uint8Array([1, 2]))).toBe("AQI");
    expect(bytesToBase64Url(new Uint8Array([0, 0, 1]))).toBe("AAAB");
    expect(bytesToBase64Url(new Uint8Array([253, 254, 255]))).toBe("_f7_");
    expect(bytesToBase64Url(new Uint8Array([]))).toBe("");
  });

  it("never emits +, / or =", () => {
    for (let i = 0; i < 256; i++) {
      const s = bytesToBase64Url(new Uint8Array([i, i, i]));
      expect(!/[+/=]/.test(s)).toBe(true);
    }
  });
});

describe("base64UrlToBytes", () => {
  it("round-trips every 0..255 triple pattern", () => {
    for (let i = 0; i < 256; i++) {
      const bytes = new Uint8Array([i, (i * 7) % 256, (i * 13) % 256]);
      expect(base64UrlToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    }
    // tail lengths 1 and 2 bytes too
    for (let i = 0; i < 256; i += 17) {
      const one = new Uint8Array([i]);
      const two = new Uint8Array([i, 255 - i]);
      expect(base64UrlToBytes(bytesToBase64Url(one))).toEqual(one);
      expect(base64UrlToBytes(bytesToBase64Url(two))).toEqual(two);
    }
  });

  it("rejects standard-base64 alphabet characters", () => {
    expect(() => base64UrlToBytes("ab+cd")).toThrow(/base64url/);
    expect(() => base64UrlToBytes("ab/cd")).toThrow(/base64url/);
    expect(() => base64UrlToBytes("abc=")).toThrow(/base64url/);
  });

  it("rejects length % 4 === 1", () => {
    expect(() => base64UrlToBytes("a")).toThrow(/invalid base64url length/);
    expect(() => base64UrlToBytes("AbCdE")).toThrow(/invalid base64url length/);
  });

  it("rejects non-alphabet characters", () => {
    expect(() => base64UrlToBytes("a!cA")).toThrow(/invalid base64url char/);
  });
});

describe("textToBytes", () => {
  it("encodes multibyte text as UTF-8", () => {
    expect(textToBytes("Man")).toEqual(new Uint8Array([77, 97, 110]));
    expect(textToBytes("é")).toEqual(new Uint8Array([0xc3, 0xa9]));
    expect(textToBytes("")).toEqual(new Uint8Array([]));
  });
});
