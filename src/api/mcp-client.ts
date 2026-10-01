/**
 * Minimal MCP (Model Context Protocol) client over streamable HTTP.
 *
 * Why this exists: AgileDay withdrew REST-audience token issuance from its
 * OAuth server. Tokens now carry `aud: <base>/api/v1/mcp` and
 * `scope: "mcp:read mcp:write"`, which every REST endpoint rejects with 401
 * "Authentication token is not valid for this resource". The MCP endpoint is
 * the only surface those tokens open, so this is the transport the beta
 * provider speaks.
 *
 * Scope is deliberately narrow — `initialize` plus `tools/call`. No prompts,
 * resources, sampling, or server-initiated messages: the tracker only ever
 * calls tools, and every call supplies its arguments in full so the server
 * never needs to elicit anything from a user.
 */

import type { AuthState } from "./auth";
import { isTokenExpired } from "./auth";
import { AuthError, audienceCoversMcp, decodeTokenClaims } from "./token-claims";

/** The protocol revision this client is written against. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** JSON-RPC error code the server returns when the bearer token is missing or stale. */
const JSONRPC_UNAUTHORIZED = -32001;

export interface McpClientConfig {
  /** e.g. "https://qvik.agileday.io/api" */
  apiBaseUrl: string;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * The envelope every MCP tool result arrives in. Structured payloads come back
 * as a JSON document inside a text content block rather than as native JSON,
 * so callers have to parse twice.
 */
interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
}

export interface McpClient {
  callTool<T>(name: string, args: Record<string, unknown>): Promise<T>;
  /** Drop the negotiated session so the next call re-handshakes. */
  reset(): void;
}

/**
 * A streamable-HTTP response may be `application/json` or `text/event-stream`
 * even for a single reply. Accept both rather than depending on server mood.
 */
function parseRpcBody(contentType: string, body: string): JsonRpcResponse {
  if (!contentType.includes("text/event-stream")) {
    return JSON.parse(body) as JsonRpcResponse;
  }
  // Take the last `data:` payload that parses — SSE may interleave comments
  // and keep-alives around the one frame we care about.
  const payloads = body
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
  for (let i = payloads.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(payloads[i]) as JsonRpcResponse;
    } catch {
      // Not this frame; keep walking back.
    }
  }
  throw new Error("MCP response contained no parseable event-stream data frame");
}

export function createMcpClient(
  config: McpClientConfig,
  getValidToken: () => Promise<string>,
  getAuthState: () => AuthState | null,
  fetchOverride?: typeof globalThis.fetch
): McpClient {
  const url = `${config.apiBaseUrl.replace(/\/+$/, "")}/v1/mcp`;

  if (!url.startsWith("https://")) {
    throw new Error("MCP calls must use HTTPS");
  }

  let resolvedFetch: typeof globalThis.fetch | null = fetchOverride ?? null;
  let sessionId: string | null = null;
  let handshake: Promise<void> | null = null;
  let nextId = 1;

  async function getResolvedFetch() {
    if (!resolvedFetch) {
      try {
        const mod = await import("@tauri-apps/plugin-http");
        resolvedFetch = mod.fetch;
      } catch {
        resolvedFetch = globalThis.fetch;
      }
    }
    return resolvedFetch;
  }

  /**
   * The MCP endpoint rejects a bad token the same way REST does, so the beta
   * provider gets the same actionable classification the REST one has.
   */
  function buildAuthError(status: number, body: string): AuthError {
    const auth = getAuthState();
    const claims = auth?.accessToken ? decodeTokenClaims(auth.accessToken) : null;

    if (auth && isTokenExpired(auth, 0)) {
      return new AuthError({
        kind: "expired",
        status,
        url,
        body,
        message: "Your AgileDay session expired — please sign in again.",
      });
    }

    if (!audienceCoversMcp(claims, config.apiBaseUrl)) {
      const audience = Array.isArray(claims?.aud) ? claims.aud.join(", ") : claims?.aud;
      return new AuthError({
        kind: "wrong-audience",
        status,
        url,
        body,
        message:
          `Your AgileDay sign-in isn't valid for the MCP API. The token was issued ` +
          `for "${audience}"` +
          (claims?.scope ? ` with scope "${claims.scope}"` : "") +
          `, which doesn't cover ${url}.`,
      });
    }

    return new AuthError({
      kind: "unauthorized",
      status,
      url,
      body,
      message: `MCP auth failed (${status}) at ${url}: ${body}`,
    });
  }

  async function rpc(method: string, params?: unknown, isNotification = false): Promise<unknown> {
    const token = await getValidToken();
    const doFetch = await getResolvedFetch();

    const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params !== undefined) payload.params = params;
    if (!isNotification) payload.id = nextId++;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      // Streamable HTTP lets the server pick either shape; parseRpcBody handles both.
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      Origin: new URL(config.apiBaseUrl).origin,
      "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
    };
    if (sessionId) headers["Mcp-Session-Id"] = sessionId;

    const startedAt = performance.now();
    let response: Response;
    try {
      response = await doFetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
    } catch (err) {
      console.log(
        `[MCP] ${method} → network error (${Math.round(performance.now() - startedAt)}ms)`
      );
      throw err;
    }
    console.log(
      `[MCP] ${method} → ${response.status} (${Math.round(performance.now() - startedAt)}ms)`
    );

    // The server assigns a session on initialize and expects it echoed back.
    const assigned = response.headers.get("mcp-session-id");
    if (assigned) sessionId = assigned;

    if (response.status === 401 || response.status === 403) {
      throw buildAuthError(response.status, await response.text().catch(() => ""));
    }

    // A 404 on a session-bearing call means the server dropped our session.
    // Clearing it lets the caller re-handshake instead of failing forever.
    if (response.status === 404 && sessionId) {
      sessionId = null;
      handshake = null;
      throw new Error("MCP session expired");
    }

    // Notifications are answered with 202 and an empty body.
    if (isNotification) return undefined;

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`MCP error ${response.status} at ${url}: ${text}`);
    }

    const rpcResponse = parseRpcBody(response.headers.get("content-type") ?? "", text);
    if (rpcResponse.error) {
      if (rpcResponse.error.code === JSONRPC_UNAUTHORIZED) {
        throw buildAuthError(401, rpcResponse.error.message);
      }
      throw new Error(`MCP ${method} failed: ${rpcResponse.error.message}`);
    }
    return rpcResponse.result;
  }

  /** Single-flight: concurrent first calls must not each open a session. */
  async function ensureHandshake(): Promise<void> {
    if (!handshake) {
      handshake = (async () => {
        await rpc("initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "qte-time-tracker", version: "beta" },
        });
        // Required by the spec before the session accepts tool calls.
        await rpc("notifications/initialized", undefined, true);
      })();
    }
    try {
      await handshake;
    } catch (err) {
      handshake = null;
      throw err;
    }
  }

  /**
   * Tool payloads arrive as a JSON document inside a text content block.
   * `structuredContent` is preferred when the server provides it.
   */
  function unwrap<T>(toolName: string, result: unknown): T {
    const envelope = result as McpToolResult | null;
    if (!envelope) throw new Error(`MCP tool ${toolName} returned no result`);

    const text = envelope.content?.find((block) => block.type === "text")?.text;

    if (envelope.isError) {
      throw new Error(`MCP tool ${toolName} failed: ${text ?? "unknown error"}`);
    }

    if (envelope.structuredContent !== undefined) return envelope.structuredContent as T;
    if (text === undefined) throw new Error(`MCP tool ${toolName} returned no text content`);

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`MCP tool ${toolName} returned non-JSON content: ${text.slice(0, 200)}`);
    }
  }

  return {
    async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
      await ensureHandshake();
      try {
        return unwrap<T>(name, await rpc("tools/call", { name, arguments: args }));
      } catch (err) {
        // One retry after a dropped session, so a long-idle app recovers
        // without bouncing the user to the login screen.
        if (err instanceof Error && err.message === "MCP session expired") {
          await ensureHandshake();
          return unwrap<T>(name, await rpc("tools/call", { name, arguments: args }));
        }
        throw err;
      }
    },

    reset() {
      sessionId = null;
      handshake = null;
    },
  };
}
