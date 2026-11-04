import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { request } from "../api/http";
import { clearSession, getCachedUser, getToken, saveSession } from "./session";
import type { AuthUser } from "./types";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(getCachedUser);
  const [loading, setLoading] = useState(Boolean(getToken()));

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    request<AuthUser>("/api/v1/auth/me")
      .then((me) => {
        saveSession(token, me);
        setUser(me);
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

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
        const result = await request<{ access_token: string; user: AuthUser }>(
          "/api/v1/auth/login",
          { method: "POST", body: JSON.stringify({ username, password }) },
        );
        saveSession(result.access_token, result.user);
        window.location.hash = "#/dashboard";
        setUser(result.user);
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
