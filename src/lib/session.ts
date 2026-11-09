// Session-token storage: `localStorage` under `nporkerd.session`, so a login
// survives closing the tab or browser until the token expires (30 days, not
// sliding) or the user logs out (decision D-04, option B). Every tab of the
// site shares it; SessionProvider follows changes made in other tabs.
// The private key is never stored anywhere by the app.

export const SESSION_STORAGE_KEY = "nporkerd.session";

export function readSessionToken(): string | undefined {
  try {
    const value = localStorage.getItem(SESSION_STORAGE_KEY);
    if (value !== null && value !== "") return value;
    // one-time move of a login made while tokens lived in sessionStorage
    const legacy = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (legacy !== null && legacy !== "") {
      localStorage.setItem(SESSION_STORAGE_KEY, legacy);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return legacy;
    }
    return undefined;
  } catch {
    // storage is unavailable in a couple of privacy contexts; the app then
    // simply has to log in again after each reload.
    return undefined;
  }
}

export function writeSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // nothing else to do: without storage the token still lives in the page
  }
}

export function clearSessionToken(): void {
  try {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** Calls `onChange` when another tab logs in or out. Returns an unsubscribe. */
export function watchSessionToken(onChange: (token: string | undefined) => void): () => void {
  const handler = (e: StorageEvent) => {
    // e.key === null: the whole storage was cleared
    if (e.storageArea !== localStorage || (e.key !== null && e.key !== SESSION_STORAGE_KEY)) return;
    const value = e.key === null ? null : e.newValue;
    onChange(value === null || value === "" ? undefined : value);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
