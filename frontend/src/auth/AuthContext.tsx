import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { refreshMediaToken } from "../api/scc";
import { request } from "../api/http";
import { clearSession, getCachedUser, getToken, saveSession } from "./session";
import type { AuthUser } from "./types";

/** Keep attachment tokens warm well under the default 12h media TTL. */
const MEDIA_KEEPALIVE_MS = 15 * 60 * 1000;

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

async function ensureMediaToken(): Promise<string | null> {
  try {
    return await refreshMediaToken();
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getCachedUser);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const me = await request<AuthUser>("/api/v1/auth/me");
        // Production /uploads requires media_token — mint one on every boot.
        const media = await ensureMediaToken();
        saveSession(token, me, media);
        setUser(me);
      } catch {
        clearSession();
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Keep media_token alive for the whole login (interval + tab focus).
  useEffect(() => {
    if (!user || !getToken()) return;

    const keepAlive = () => {
      if (document.visibilityState === "hidden") return;
      if (!getToken()) return;
      void ensureMediaToken();
    };

    const intervalId = window.setInterval(keepAlive, MEDIA_KEEPALIVE_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") keepAlive();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", keepAlive);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", keepAlive);
    };
  }, [user]);

  useEffect(() => {
    const onDenied = () => {
      clearSession();
      setUser(null);
    };
    window.addEventListener("scc-unauthorized", onDenied);
    return () => window.removeEventListener("scc-unauthorized", onDenied);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      login: async (username, password) => {
        const result = await request<{
          access_token: string;
          media_token?: string | null;
          user: AuthUser;
        }>("/api/v1/auth/login", {
          method: "POST",
          body: JSON.stringify({ username, password }),
        });
        saveSession(result.access_token, result.user, result.media_token);
        if (!result.media_token) {
          await ensureMediaToken();
        } else {
          window.dispatchEvent(new Event("scc-media-token"));
        }
        setUser(result.user);
        if (!result.user.must_change_password) {
          window.location.hash = "#/dashboard";
        }
        return result.user;
      },
      changePassword: async (currentPassword, newPassword) => {
        const updated = await request<AuthUser>("/api/v1/auth/change-password", {
          method: "POST",
          body: JSON.stringify({
            current_password: currentPassword,
            new_password: newPassword,
          }),
        });
        const token = getToken();
        if (token) saveSession(token, updated);
        await ensureMediaToken();
        setUser(updated);
        window.location.hash = "#/dashboard";
        return updated;
      },
      logout: async () => {
        try {
          await request("/api/v1/auth/logout", { method: "POST" });
        } catch {
          /* still clear locally */
        }
        clearSession();
        setUser(null);
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
