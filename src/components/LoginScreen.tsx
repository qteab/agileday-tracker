import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { login } from "../api/auth-manager";

export function LoginScreen() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLogin() {
    setLoading(true);
    setError("");
    try {
      await login();
      // Auth state is saved — trigger a re-render by dispatching
      // The context will pick up the new auth state
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-screen bg-bg">
      <div
        onMouseDown={(e) => {
          if (e.button === 0 && e.detail === 1) {
            e.preventDefault();
            getCurrentWindow().startDragging();
          }
        }}
        className="flex items-center justify-center px-4 pt-5 pb-2 bg-bg-card border-b border-border cursor-default"
      >
        <span className="text-xs font-semibold tracking-wide text-primary uppercase pointer-events-none">
          QTE Time Tracker
        </span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-8 gap-6">
        <div className="text-center space-y-2">
          <h1 className="text-lg font-semibold text-text">Welcome</h1>
          <p className="text-sm text-text-muted">
            Sign in with your AgileDay account to start tracking time.
          </p>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full max-w-[240px] py-3 text-sm text-white bg-primary hover:bg-primary-dark rounded-xl font-medium transition-colors disabled:opacity-50"
        >
          {loading ? "Waiting for sign in..." : "Sign in with AgileDay"}
        </button>

        {loading && (
          <p className="text-xs text-text-muted text-center">
            Complete the sign-in in your browser.
            <br />
            You&apos;ll be redirected back automatically.
          </p>
        )}

        {error && <p className="text-xs text-danger text-center">{error}</p>}
      </div>
    </div>
  );
}
