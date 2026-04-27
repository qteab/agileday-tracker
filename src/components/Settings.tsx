import { useState, useEffect } from "react";
import { open } from "@tauri-apps/plugin-shell";
import {
  loadAuthState,
  startLogin,
  clearAuth,
  DEFAULT_CONNECTION,
} from "../api/auth-manager";
import type { AuthState } from "../api/auth";

interface SettingsProps {
  onClose: () => void;
  onConnectionChange: () => void;
}

export function Settings({ onClose, onConnectionChange }: SettingsProps) {
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAuthState().then(setAuthState);
  }, []);

  const isConnected = authState !== null;

  async function handleConnect() {
    setLoading(true);
    setStatus("");
    try {
      const authorizeUrl = await startLogin(DEFAULT_CONNECTION);
      await open(authorizeUrl);
      setStatus("Browser opened — log in to AgileDay");
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    await clearAuth();
    setAuthState(null);
    setStatus("Disconnected — using mock data");
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
        <div className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-xs ${
          isConnected ? "bg-green-50 text-green-700" : "bg-bg text-text-muted"
        }`}>
          <span className={`w-2 h-2 rounded-full ${
            isConnected ? "bg-green-500" : "bg-text-muted/30"
          }`} />
          {isConnected ? "Connected to AgileDay" : "Not connected — using mock data"}
        </div>

        {!isConnected && (
          <>
            <p className="text-xs text-text-muted">
              Connect to sync your time entries with AgileDay. You'll be redirected to log in with your AgileDay account.
            </p>
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
              <p>Tenant: <span className="text-text font-medium">{DEFAULT_CONNECTION.tenantSlug}</span></p>
              <p>Session expires: <span className="text-text font-medium">
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
          <p className={`text-xs ${
            status.startsWith("Error") ? "text-danger" : "text-text-muted"
          }`}>
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
