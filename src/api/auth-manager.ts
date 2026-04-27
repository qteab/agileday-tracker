/**
 * Auth Manager — coordinates the OAuth PKCE flow with Tauri
 *
 * For desktop apps, the redirect URI uses a localhost callback.
 * Tauri will listen on a random port and capture the auth code.
 */

import { load } from "@tauri-apps/plugin-store";
import type { AuthConfig, AuthState } from "./auth";
import {
  generatePKCE,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  tokenResponseToAuthState,
} from "./auth";

const AUTH_STORE_FILE = "auth.json";

// Use a localhost redirect for desktop OAuth
const REDIRECT_URI = "http://localhost:19847/oauth/callback";

export interface ConnectionConfig {
  tenantSlug: string; // e.g. "qvik"
  clientId: string;
}

export function buildAuthConfig(conn: ConnectionConfig): AuthConfig {
  return {
    oauthBaseUrl: `https://${conn.tenantSlug}.agileday.io/api/v1/oauth`,
    clientId: conn.clientId,
    redirectUri: REDIRECT_URI,
  };
}

export function buildApiBaseUrl(conn: ConnectionConfig): string {
  return `https://${conn.tenantSlug}.agileday.io/api`;
}

async function getAuthStore() {
  return await load(AUTH_STORE_FILE, { autoSave: true, defaults: {} });
}

export async function loadAuthState(): Promise<AuthState | null> {
  const store = await getAuthStore();
  return (await store.get<AuthState>("authState")) ?? null;
}

export async function saveAuthState(state: AuthState): Promise<void> {
  const store = await getAuthStore();
  await store.set("authState", state);
}

export async function clearAuth(): Promise<void> {
  const store = await getAuthStore();
  await store.delete("authState");
  await store.delete("connectionConfig");
}

export async function loadConnectionConfig(): Promise<ConnectionConfig | null> {
  const store = await getAuthStore();
  return (await store.get<ConnectionConfig>("connectionConfig")) ?? null;
}

export async function saveConnectionConfig(config: ConnectionConfig): Promise<void> {
  const store = await getAuthStore();
  await store.set("connectionConfig", config);
}

/**
 * Start the OAuth PKCE login flow.
 * Returns the authorize URL to open in the browser.
 * The PKCE verifier is stored temporarily for the token exchange.
 */
export async function startLogin(conn: ConnectionConfig): Promise<string> {
  const authConfig = buildAuthConfig(conn);
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = crypto.randomUUID();

  // Store PKCE state temporarily
  const store = await getAuthStore();
  await store.set("pkceVerifier", codeVerifier);
  await store.set("pkceState", state);

  return buildAuthorizeUrl(authConfig, codeChallenge, state);
}

/**
 * Complete the OAuth flow by exchanging the auth code for tokens.
 * Call this after the user is redirected back with the code.
 */
export async function completeLogin(
  conn: ConnectionConfig,
  code: string,
  returnedState: string
): Promise<AuthState> {
  const store = await getAuthStore();
  const savedState = await store.get<string>("pkceState");
  const codeVerifier = await store.get<string>("pkceVerifier");

  if (!savedState || savedState !== returnedState) {
    throw new Error("Invalid OAuth state — possible CSRF attack");
  }
  if (!codeVerifier) {
    throw new Error("Missing PKCE verifier — please restart login");
  }

  const authConfig = buildAuthConfig(conn);
  const tokens = await exchangeCodeForTokens(authConfig, code, codeVerifier);
  const authState = tokenResponseToAuthState(tokens);

  // Save auth state and clean up PKCE temporaries
  await saveAuthState(authState);
  await saveConnectionConfig(conn);
  await store.delete("pkceVerifier");
  await store.delete("pkceState");

  return authState;
}
