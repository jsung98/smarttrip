"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AuthUser } from "@/lib/auth/session";
import type { AuthState } from "@/lib/tripStorage";

type AuthContextValue = AuthState & {
  refreshAuth: () => Promise<void>;
  logout: () => Promise<void>;
  loginHref: string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchAuthState(): Promise<AuthState> {
  try {
    const res = await fetch("/api/auth/me", { cache: "no-store" });
    const json = (await res.json()) as { user?: AuthUser | null };
    return json.user ? { status: "authenticated", user: json.user } : { status: "guest" };
  } catch {
    return { status: "guest" };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  const refreshAuth = useCallback(async () => {
    setState(await fetchAuthState());
  }, []);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    await refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      refreshAuth,
      logout,
      loginHref: "/api/auth/kakao/login",
    }),
    [logout, refreshAuth, state]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
}
