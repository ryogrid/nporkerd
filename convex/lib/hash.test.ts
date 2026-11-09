// Unit tests for sha256Hex — vectors cross-checked against node:crypto.
import { sha256Hex } from "./hash";
import { expect, test } from "vitest";

test("sha256Hex known vectors", async () => {
  expect(await sha256Hex("")).eq(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  expect(await sha256Hex("abc")).eq(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(await sha256Hex("The quick brown fox jumps over the lazy dog")).eq(
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592",
  );
});

test("Uint8Array input agrees with string input", async () => {
  expect(await sha256Hex(new Uint8Array([97, 98, 99]))).eq(await sha256Hex("abc"));
});
