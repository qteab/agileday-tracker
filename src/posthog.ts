import { getVersion } from "@tauri-apps/api/app";
import posthog, { type PostHog } from "posthog-js";
// PostHog normally downloads these extensions from its CDN at runtime. We bundle
// them instead (and set disable_external_dependency_loading) so the app never
// runs remote scripts — the webview has access to Tauri IPC.
import "posthog-js/dist/exception-autocapture";
import "posthog-js/dist/logs";

import { scrubExceptionEvent } from "./utils/telemetry-scrub";

const posthogKey = import.meta.env.VITE_POSTHOG_KEY;
const posthogHost = import.meta.env.VITE_POSTHOG_HOST;
const sendFromDevBuilds = import.meta.env.VITE_POSTHOG_ENABLE_IN_DEV === "true";

/**
 * Telemetry runs only in release builds that were given a key at build time.
 * Tests never send events, and dev builds only send when explicitly opted in,
 * so developer activity doesn't pollute the analytics.
 */
function isTelemetryEnabled(): boolean {
  if (!posthogKey || !posthogHost) return false;
  if (import.meta.env.MODE === "test") return false;
  if (import.meta.env.DEV && !sendFromDevBuilds) return false;
  return true;
}

function initPostHog(apiKey: string, apiHost: string): PostHog {
  return posthog.init(apiKey, {
    api_host: apiHost,
    defaults: "2026-08-30",
    disable_external_dependency_loading: true,
    // Anonymous by design: no identify(), no person profiles, no GeoIP.
    // Each install keeps a random ID so unique-user counts still work.
    person_profiles: "never",
    before_send: scrubExceptionEvent,
    // Explicit events only. Session replay would record entry descriptions,
    // customer and project names, so it stays off even if enabled in PostHog.
    autocapture: false,
    disable_session_recording: true,
    capture_heatmaps: false,
    capture_dead_clicks: false,
    disable_surveys: true,
    disable_product_tours: true,
    disable_conversations: true,
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: "agileday-tracker-web",
      environment: import.meta.env.MODE,
    },
  });
}

async function registerAppVersion(client: PostHog) {
  try {
    const appVersion = await getVersion();
    client.register({ app_version: appVersion });
  } catch {
    // Not running inside Tauri — events just go without a version.
  }
}

function createPostHogClient(): PostHog | undefined {
  if (!isTelemetryEnabled() || !posthogKey || !posthogHost) return undefined;

  const client = initPostHog(posthogKey, posthogHost);
  // Skip city/country lookup from the IP address on every event.
  client.register({ $geoip_disable: true });
  void registerAppVersion(client);
  return client;
}

export const posthogClient = createPostHogClient();

export const posthogLogger = posthogClient?.logger;
