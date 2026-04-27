import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  loadConnectionConfig,
  loadAuthState,
  saveConnectionConfig,
  startLogin,
  clearAuth,
  type ConnectionConfig,
} from "../api/auth-manager";
import type { AuthState } from "../api/auth";

interface SettingsProps {
  onClose: () => void;
  onConnectionChange: () => void;
}

export function Settings({ onClose, onConnectionChange }: SettingsProps) {
  const [tenantSlug, setTenantSlug] = useState("");
  const [clientId, setClientId] = useState("");
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [connConfig, setConnConfig] = useState<ConnectionConfig | null>(null);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConnectionConfig().then((config) => {
      if (config) {
        setTenantSlug(config.tenantSlug);
        setClientId(config.clientId);
        setConnConfig(config);
      }
    });
    loadAuthState().then(setAuthState);
  }, []);

  const isConnected = authState !== null;

  async function handleConnect() {
    if (!tenantSlug.trim() || !clientId.trim()) {
      setStatus("Please fill in both fields");
      return;
    }

    setLoading(true);
    setStatus("");

    try {
      const conn: ConnectionConfig = {
        tenantSlug: tenantSlug.trim(),
        clientId: clientId.trim(),
      };

      await saveConnectionConfig(conn);

      const authorizeUrl = await startLogin(conn);

      // Open the authorize URL in the default browser
      await open(authorizeUrl);

      setStatus("Browser opened — log in to AgileDay and paste the code below");
      setConnConfig(conn);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    await clearAuth();
    setAuthState(null);
    setStatus("Disconnected");
    onConnectionChange();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-text-muted hover:text-text"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <h3 className="text-sm font-semibold text-text">AgileDay Connection</h3>

        {/* Connection status */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          isConnected ? "bg-green-50 text-green-700" : "bg-bg text-text-muted"
        }`}>
          <span className={`w-2 h-2 rounded-full ${isConnected ? "bg-green-500" : "bg-text-muted/30"}`} />
          {isConnected ? "Connected to AgileDay" : "Not connected — using mock data"}
        </div>

        {!isConnected && (
          <>
            {/* Tenant slug */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Tenant</label>
              <div className="flex items-center gap-0 border border-border rounded-lg overflow-hidden bg-bg">
                <span className="px-2 text-xs text-text-muted bg-bg border-r border-border">https://</span>
                <input
                  type="text"
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  placeholder="qvik"
                  className="flex-1 px-2 py-2 text-sm bg-bg outline-none"
                />
                <span className="px-2 text-xs text-text-muted bg-bg border-l border-border">.agileday.io</span>
              </div>
            </div>

            {/* Client ID */}
            <div className="space-y-1">
              <label className="text-xs text-text-muted">Client ID</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="HQKI3rjbgOAjAk-zmz3QCQ"
                className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-bg outline-none focus:border-primary"
              />
            </div>

            {/* Connect button */}
            <button
              onClick={handleConnect}
              disabled={loading}
              className="w-full py-2.5 text-sm text-white bg-primary hover:bg-primary-dark rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {loading ? "Opening browser..." : "Connect to AgileDay"}
            </button>
          </>
        )}

        {isConnected && (
          <div className="space-y-3">
            <div className="text-xs text-text-muted space-y-1">
              <p>Tenant: <span className="text-text font-medium">{connConfig?.tenantSlug}</span></p>
              <p>Token expires: <span className="text-text font-medium">
                {new Date(authState.expiresAt).toLocaleString()}
              </span></p>
            </div>
            <button
              onClick={handleDisconnect}
              className="w-full py-2 text-sm text-danger border border-danger/30 hover:bg-danger/5 rounded-lg font-medium transition-colors"
            >
              Disconnect
            </button>
          </div>
        )}

        {status && (
          <p className={`text-xs ${status.startsWith("Error") ? "text-danger" : "text-text-muted"}`}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
