/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** PostHog project token, set at build time. Missing = telemetry off. */
  readonly VITE_POSTHOG_KEY?: string;
  /** PostHog ingestion host, e.g. https://eu.i.posthog.com. */
  readonly VITE_POSTHOG_HOST?: string;
  /** "true" to send events from dev builds. */
  readonly VITE_POSTHOG_ENABLE_IN_DEV?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
