import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

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
    const timer = setTimeout(checkForUpdate, 3000);
    return () => clearTimeout(timer);
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
    <div className="flex flex-col px-4 py-2 bg-primary/10 text-primary text-xs gap-1">
      <div className="flex items-center justify-between">
        <span>{installing ? "Installing update..." : `Version ${version} available`}</span>
        {!installing && (
          <div className="flex gap-2">
            <button onClick={() => setDismissed(true)} className="text-text-muted hover:text-text">
              Later
            </button>
            <button onClick={handleUpdate} className="font-medium hover:text-primary-dark">
              Update
            </button>
          </div>
        )}
      </div>
      {error && <span className="text-danger text-[10px]">{error}</span>}
    </div>
  );
}
