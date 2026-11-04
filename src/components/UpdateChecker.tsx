import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useEffect, useState } from "react";

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [version, setVersion] = useState("");
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    async function checkForUpdate() {
      try {
        const update = await check();
        if (update) {
          setUpdateAvailable(true);
          setVersion(update.version);
        }
      } catch {
        // Silent fail — update check is non-critical
      }
    }

    // Check on launch (after 3s delay)
    const initialTimer = setTimeout(checkForUpdate, 3000);

    // Re-check every 2 hours
    const interval = setInterval(checkForUpdate, 2 * 60 * 60 * 1000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, []);

  async function handleUpdate() {
    setInstalling(true);
    setError("");
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setInstalling(false);
    }
  }

  if (!updateAvailable || dismissed) return null;

  return (
    <div className="flex flex-col gap-1 bg-primary/10 px-4 py-2 text-xs text-primary">
      <div className="flex items-center justify-between">
        <span>{installing ? "Installing update..." : `Version ${version} available`}</span>
        {!installing && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                setDismissed(true);
              }}
              className="text-text-muted hover:text-text"
            >
              Later
            </button>
            <button
              onClick={() => {
                void handleUpdate();
              }}
              className="font-medium hover:text-primary-dark"
            >
              Update
            </button>
          </div>
        )}
      </div>
      {error && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  );
}
