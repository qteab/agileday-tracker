/**
 * OAuth 2.1 PKCE Authentication for AgileDay
 *
 * Flow:
 * 1. Generate code_verifier (random string) and code_challenge (SHA-256 hash)
 * 2. Open browser to authorize URL with client_id, code_challenge, redirect_uri
 * 3. User logs in at AgileDay, gets redirected back with auth code
 * 4. Exchange auth code + code_verifier for access_token + refresh_token
 * 5. Store tokens securely (Tauri store)
 * 6. Use access_token as Bearer token for API calls
 * 7. Refresh when expired
 */

export interface AuthConfig {
  /** e.g. "https://qvik.agileday.io/api/v1/oauth" */
  oauthBaseUrl: string;
  clientId: string;
  /** Where AgileDay redirects after login. For desktop apps, use a custom scheme or localhost */
  redirectUri: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

export interface AuthState {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix timestamp ms
}

// --- PKCE helpers ---

function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePKCE(): Promise<{
  codeVerifier: string;
  codeChallenge: string;
}> {
  const codeVerifier = generateRandomString(64);
  const hash = await sha256(codeVerifier);
  const codeChallenge = base64UrlEncode(hash);
  return { codeVerifier, codeChallenge };
}

// --- Auth flow ---

export function buildAuthorizeUrl(
  config: AuthConfig,
  codeChallenge: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${config.oauthBaseUrl}/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(
  config: AuthConfig,
  code: string,
  codeVerifier: string
): Promise<TokenResponse> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  const response = await tauriFetch(`${config.oauthBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new Error(`Token exchange failed (${response.status}): ${error}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Token exchange returned invalid response — expected JSON");
  }
}

export async function refreshAccessToken(
  config: AuthConfig,
  refreshToken: string
): Promise<TokenResponse> {
  const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
  const response = await tauriFetch(`${config.oauthBaseUrl}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!response.ok) {
    const error = await response.text().catch(() => "Unknown error");
    throw new Error(`Token refresh failed (${response.status}): ${error}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error("Token refresh returned invalid response — expected JSON");
  }
}

export function tokenResponseToAuthState(tokens: TokenResponse): AuthState {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
}

export function isTokenExpired(state: AuthState, bufferMs = 60_000): boolean {
  return Date.now() >= state.expiresAt - bufferMs;
}
