// SHA-256 hex via WebCrypto (design/02 §8 helper table). Works in the Convex
// edge runtime and in the browser; deliberately no server-only imports so the
// SPA can reuse it.
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const view = new Uint8Array(digest);
  let hex = "";
  for (const b of view) hex += b.toString(16).padStart(2, "0");
  return hex;
}
