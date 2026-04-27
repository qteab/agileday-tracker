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

let storeInstance: Awaited<ReturnType<typeof load>> | null = null;

const REDIRECT_URI = "http://localhost:19847/auth/callback";
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

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
  if (!storeInstance) {
    storeInstance = await load(AUTH_STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

export async function loadAuthState(): Promise<AuthState | null> {
  const store = await getAuthStore();
  return (await store.get<AuthState>("authState")) ?? null;
}

export async function saveAuthState(state: AuthState): Promise<void> {
  const store = await getAuthStore();
  await store.set("authState", state);
  await store.save();
}

export async function clearAuth(): Promise<void> {
  const store = await getAuthStore();
  await store.delete("authState");
  await store.save();
}

/**
 * Full login flow with error handling at every step.
 * Throws descriptive errors so the UI can show what went wrong.
 */
export async function login(conn: ConnectionConfig = DEFAULT_CONNECTION): Promise<AuthState> {
  const authConfig = buildAuthConfig(conn);

  // Step 1: Generate PKCE
  let codeVerifier: string;
  let codeChallenge: string;
  try {
    const pkce = await generatePKCE();
    codeVerifier = pkce.codeVerifier;
    codeChallenge = pkce.codeChallenge;
  } catch (err) {
    throw new Error(
      `Failed to generate security keys: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  const state = crypto.randomUUID();
  const authorizeUrl = buildAuthorizeUrl(authConfig, codeChallenge, state);

  // Step 2: Start callback server (before opening browser)
  let callbackPromise: Promise<[string, string]>;
  try {
    callbackPromise = invoke<[string, string]>("wait_for_oauth_callback");
  } catch (err) {
    throw new Error(
      `Failed to start login server: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  // Step 3: Open browser
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(authorizeUrl);
  } catch (err) {
    throw new Error(`Failed to open browser: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }

  // Step 4: Wait for callback with timeout
  let code: string;
  let returnedState: string;
  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Login timed out — please try again")), LOGIN_TIMEOUT_MS)
    );
    [code, returnedState] = await Promise.race([callbackPromise, timeoutPromise]);
  } catch (err) {
    throw new Error(`Login callback failed: ${err instanceof Error ? err.message : String(err)}`, {
      cause: err,
    });
  }

  // Step 5: Validate state (CSRF protection)
  if (returnedState !== state) {
    throw new Error("Security check failed — the login response doesn't match. Please try again.");
  }

  // Step 6: Exchange code for tokens
  let tokens;
  try {
    tokens = await exchangeCodeForTokens(authConfig, code, codeVerifier);
  } catch (err) {
    throw new Error(
      `Failed to complete sign-in: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  if (!tokens.access_token) {
    throw new Error(
      "Sign-in succeeded but no access token was returned. Please contact your admin."
    );
  }

  // Step 7: Save tokens
  const authState = tokenResponseToAuthState(tokens);
  try {
    await saveAuthState(authState);
  } catch {
    // Non-fatal — token is in memory, just won't persist across restarts
  }

  return authState;
}
