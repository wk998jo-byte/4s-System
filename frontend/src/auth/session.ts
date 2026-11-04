import type { AuthUser } from "./types";

const TOKEN_KEY = "scc_token";
const USER_KEY = "scc_user";

export function getToken(): string | null {
  return window.localStorage.getItem(TOKEN_KEY);
}

export function getCachedUser(): AuthUser | null {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function saveSession(token: string, user: AuthUser): void {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}
