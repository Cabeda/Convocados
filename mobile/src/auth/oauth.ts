/**
 * OAuth flow for React Native.
 *
 * Uses a simple browser-based flow:
 * 1. Opens system browser → server's mobile-callback endpoint
 * 2. Server redirects to login page if not authenticated
 * 3. User signs in (Google, magic link, etc.)
 * 4. Server generates a one-time code and redirects to convocados://auth?code=xxx
 * 5. App exchanges the code for real OAuth tokens
 */
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { getServerUrl, setTokens, getTokens, clearTokens, isTokenExpired } from "./storage";
import type { OAuthTokens } from "~/types/api";

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URI = "convocados://auth";

export interface AuthResult {
  tokens: OAuthTokens;
}

/**
 * Start the login flow.
 * Opens the system browser where the user logs in, then redirects back to the app.
 */
export async function login(): Promise<AuthResult> {
  const serverUrl = await getServerUrl();

  const authUrl = `${serverUrl}/api/auth/mobile-callback?redirect_uri=${encodeURIComponent(REDIRECT_URI)}`;

  const result = await WebBrowser.openAuthSessionAsync(authUrl, REDIRECT_URI);

  if (result.type !== "success" || !result.url) {
    throw new Error("Login cancelled or failed");
  }

  const url = new URL(result.url);
  const code = url.searchParams.get("code");
  if (!code) {
    const error = url.searchParams.get("error") || "No auth code received";
    throw new Error(error);
  }

  // Exchange the one-time code for real tokens
  const tokenRes = await fetch(`${serverUrl}/api/auth/mobile-callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({ error: "Token exchange failed" }));
    throw new Error(err.error ?? "Token exchange failed");
  }

  const tokenData = await tokenRes.json();
  const tokens: OAuthTokens = {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: Date.now() + tokenData.expires_in * 1000,
  };

  await setTokens(tokens);
  return { tokens };
}

/**
 * Refresh the access token using the refresh token.
 */
export async function refreshAccessToken(): Promise<OAuthTokens> {
  const current = await getTokens();
  if (!current?.refreshToken) throw new Error("No refresh token");

  const serverUrl = await getServerUrl();

  // Use the existing OAuth token endpoint for refresh
  const res = await fetch(`${serverUrl}/api/auth/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: "mobile-app",
    }).toString(),
  });

  if (!res.ok) {
    await clearTokens();
    throw new Error("Session expired — please log in again");
  }

  const data = await res.json();
  const tokens: OAuthTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? current.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  await setTokens(tokens);
  return tokens;
}

/**
 * Get a valid access token, refreshing if needed.
 */
export async function getValidToken(): Promise<string> {
  let tokens = await getTokens();
  if (!tokens) throw new Error("Not authenticated");

  if (isTokenExpired(tokens)) {
    tokens = await refreshAccessToken();
  }

  return tokens.accessToken;
}

/**
 * Logout — clear tokens.
 */
export async function logout(): Promise<void> {
  await clearTokens();
}
