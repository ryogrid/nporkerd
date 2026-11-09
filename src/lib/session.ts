// Session-token storage — design/07 §1: `sessionStorage` under
// `nporkerd.session`, so the token survives a reload within the tab session
// and dies when the browser closes (the safer half of decision D-04). The
// private key is never stored anywhere by the app.

export const SESSION_STORAGE_KEY = "nporkerd.session";

export function readSessionToken(): string | undefined {
  try {
    const value = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return value === null || value === "" ? undefined : value;
  } catch {
    // sessionStorage is unavailable in a couple of privacy contexts; the app
    // then simply has to log in again after each reload.
    return undefined;
  }
}

export function writeSessionToken(token: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // nothing else to do: without storage the token still lives in the page
  }
}

export function clearSessionToken(): void {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // ignore
  }
}
