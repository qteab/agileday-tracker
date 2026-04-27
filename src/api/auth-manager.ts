/**
 * Auth Manager — coordinates the OAuth PKCE flow
 *
 * Flow:
 * 1. Start localhost HTTP server (Tauri command)
 * 2. Open browser to AgileDay login
 * 3. User logs in → AgileDay redirects to http://localhost:19847/auth/callback
 * 4. Tauri captures the callback, returns code + state
 * 5. Exchange code for tokens
 */

import { load } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import type { AuthConfig, AuthState } from "./auth";
import {
  generatePKCE,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  tokenResponseToAuthState,
} from "./auth";

const AUTH_STORE_FILE = "auth.json";

const REDIRECT_URI = "http://localhost:19847/auth/callback";

// Hardcoded defaults — same for all QTE employees
const DEFAULT_TENANT_SLUG = "qvik";
const DEFAULT_CLIENT_ID = "HQKI3rjbgOAjAk-zmz3QCQ";

export interface ConnectionConfig {
  tenantSlug: string;
  clientId: string;
}

export const DEFAULT_CONNECTION: ConnectionConfig = {
  tenantSlug: DEFAULT_TENANT_SLUG,
  clientId: DEFAULT_CLIENT_ID,
};

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
}

/**
 * Full login flow:
 * 1. Generate PKCE
 * 2. Start localhost callback server (Tauri command, runs in background)
 * 3. Open browser to authorize URL
 * 4. Wait for callback (Tauri command resolves when user completes login)
 * 5. Exchange code for tokens
 * 6. Save and return auth state
 */
export async function login(conn: ConnectionConfig = DEFAULT_CONNECTION): Promise<AuthState> {
  const authConfig = buildAuthConfig(conn);
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = crypto.randomUUID();

  const authorizeUrl = buildAuthorizeUrl(authConfig, codeChallenge, state);

  // Start the callback server BEFORE opening the browser.
  // This returns a promise that resolves when the callback is received.
  const callbackPromise = invoke<[string, string]>("wait_for_oauth_callback");

  // Open browser (caller handles this — we return the URL)
  // Actually, let's handle it here for simplicity
  const { open } = await import("@tauri-apps/plugin-shell");
  await open(authorizeUrl);

  // Wait for the OAuth callback
  const [code, returnedState] = await callbackPromise;

  // Validate CSRF state
  if (returnedState !== state) {
    throw new Error("Invalid OAuth state — possible CSRF attack");
  }

  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(authConfig, code, codeVerifier);
  const authState = tokenResponseToAuthState(tokens);

  await saveAuthState(authState);
  return authState;
}
