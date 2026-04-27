import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [version, setVersion] = useState("");
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

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
    // Check after a short delay so it doesn't block startup
    const timer = setTimeout(checkForUpdate, 3000);
    return () => clearTimeout(timer);
  }, []);

  async function handleUpdate() {
    setInstalling(true);
    try {
      const update = await check();
      if (update) {
        await update.downloadAndInstall();
        await relaunch();
      }
    } catch {
      setInstalling(false);
    }
  }

  if (!updateAvailable || dismissed) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-primary/10 text-primary text-xs">
      <span>
        {installing
          ? "Installing update..."
          : `Version ${version} available`}
      </span>
      {!installing && (
        <div className="flex gap-2">
          <button
            onClick={() => setDismissed(true)}
            className="text-text-muted hover:text-text"
          >
            Later
          </button>
          <button
            onClick={handleUpdate}
            className="font-medium hover:text-primary-dark"
          >
            Update
          </button>
        </div>
      )}
    </div>
  );
}
