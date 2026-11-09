import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";

import type { AuthState } from "../api/auth";
import { login } from "../api/auth-manager";

interface LoginScreenProps {
  onLoginSuccess: (auth: AuthState) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      const auth = await login();
      onLoginSuccess(auth);
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      setError(msg);
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen flex-col bg-bg">
      <div
        onMouseDown={(e) => {
          if (e.button === 0 && e.detail === 1) {
            e.preventDefault();
            void getCurrentWindow().startDragging();
          }
        }}
        className="flex cursor-default items-center justify-center border-b border-border bg-bg-card px-4 pt-5 pb-2"
      >
        <span className="pointer-events-none text-xs font-semibold tracking-wide text-primary uppercase">
          QTE Time Tracker
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
        <div className="space-y-2 text-center">
          <h1 className="text-lg font-semibold text-text">Welcome</h1>
          <p className="text-sm text-text-muted">
            Sign in with your AgileDay account to start tracking time.
          </p>
        </div>

        <button
          onClick={() => {
            void handleLogin();
          }}
          disabled={loading}
          className="w-full max-w-[240px] rounded-xl bg-primary py-3 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
        >
          {loading ? "Waiting for sign in..." : "Sign in with AgileDay"}
        </button>

        {loading && (
          <p className="text-center text-xs text-text-muted">
            Complete the sign-in in your browser.
            <br />
            You&apos;ll be redirected back automatically.
          </p>
        )}

        {error && <p className="max-w-[300px] text-center text-xs text-danger">{error}</p>}
      </div>
    </div>
  );
}
