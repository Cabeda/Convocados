import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getTokens, clearTokens } from "~/auth/storage";
import { login as oauthLogin, logout as oauthLogout } from "~/auth/oauth";
import { fetchUserInfo } from "~/api/endpoints";
import type { UserProfile, OAuthTokens } from "~/types/api";

interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: UserProfile | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  isLoading: true,
  isAuthenticated: false,
  user: null,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<UserProfile | null>(null);

  // Check for existing tokens on mount — don't fetch user info, just check tokens
  useEffect(() => {
    (async () => {
      try {
        const tokens = await getTokens();
        if (tokens) {
          // Fetch user info with a timeout so we don't hang on startup
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          try {
            const profile = await fetchUserInfo();
            setUser(profile);
          } catch {
            // Network error or timeout — clear tokens and show login
            await clearTokens();
          } finally {
            clearTimeout(timeout);
          }
        }
      } catch {
        await clearTokens();
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async () => {
    setIsLoading(true);
    try {
      await oauthLogin();
      const profile = await fetchUserInfo();
      setUser(profile);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await oauthLogout();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const tokens = await getTokens();
      if (tokens) {
        const profile = await fetchUserInfo();
        setUser(profile);
      }
    } catch {
      await clearTokens();
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isLoading,
        isAuthenticated: !!user,
        user,
        login,
        logout,
        refresh,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
