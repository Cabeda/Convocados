import * as SecureStore from "expo-secure-store";
import type { OAuthTokens } from "~/types/api";

const TOKEN_KEY = "convocados_oauth_tokens";
const SERVER_URL_KEY = "convocados_server_url";

/** Default server URL — points to production by default */
const DEFAULT_SERVER_URL = "https://convocados.cabeda.dev";

export async function getServerUrl(): Promise<string> {
  const url = await SecureStore.getItemAsync(SERVER_URL_KEY);
  return url || DEFAULT_SERVER_URL;
}

export async function setServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(SERVER_URL_KEY, url);
}

export async function getTokens(): Promise<OAuthTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthTokens;
  } catch {
    return null;
  }
}

export async function setTokens(tokens: OAuthTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
}

export async function clearTokens(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function isTokenExpired(tokens: OAuthTokens): boolean {
  // Consider expired 60s before actual expiry to avoid edge cases
  return Date.now() >= tokens.expiresAt - 60_000;
}
