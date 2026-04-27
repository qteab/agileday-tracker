/**
 * Auth Manager — coordinates the OAuth PKCE flow with Tauri deep links
 *
 * Flow:
 * 1. App generates PKCE challenge and opens AgileDay login in browser
 * 2. User logs in → AgileDay redirects to qte-tracker://auth/callback?code=X&state=Y
 * 3. macOS opens the app via the custom URL scheme
 * 4. App exchanges the code for tokens
 */

import { load } from "@tauri-apps/plugin-store";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { AuthConfig, AuthState } from "./auth";
import {
  generatePKCE,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  tokenResponseToAuthState,
} from "./auth";

const AUTH_STORE_FILE = "auth.json";

// Hardcoded defaults — same for all QTE employees
const DEFAULT_TENANT_SLUG = "qvik";
const DEFAULT_CLIENT_ID = "HQKI3rjbgOAjAk-zmz3QCQ";
const REDIRECT_URI = "qte-tracker://auth/callback";

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
 * Start the OAuth PKCE login flow.
 * Returns the authorize URL to open in the browser.
 */
export async function startLogin(
  conn: ConnectionConfig = DEFAULT_CONNECTION
): Promise<string> {
  const authConfig = buildAuthConfig(conn);
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = crypto.randomUUID();

  const store = await getAuthStore();
  await store.set("pkceVerifier", codeVerifier);
  await store.set("pkceState", state);

  return buildAuthorizeUrl(authConfig, codeChallenge, state);
}

/**
 * Complete the OAuth flow by exchanging the auth code for tokens.
 */
export async function completeLogin(
  code: string,
  returnedState: string,
  conn: ConnectionConfig = DEFAULT_CONNECTION
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

  await saveAuthState(authState);
  await store.delete("pkceVerifier");
  await store.delete("pkceState");

  return authState;
}

/**
 * Listen for the OAuth callback deep link.
 * Call this once on app startup.
 */
export function listenForAuthCallback(
  onCallback: (code: string, state: string) => void
): void {
  onOpenUrl((urls) => {
    for (const url of urls) {
      if (url.startsWith("qte-tracker://auth/callback")) {
        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");
        const state = parsed.searchParams.get("state");
        if (code && state) {
          onCallback(code, state);
        }
      }
    }
  });
}
