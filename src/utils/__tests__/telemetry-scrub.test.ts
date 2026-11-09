import type { CaptureResult } from "posthog-js";
import { describe, it, expect } from "vitest";

import { scrubErrorMessage, scrubExceptionEvent } from "../telemetry-scrub";

describe("scrubErrorMessage", () => {
  it("removes the AgileDay URL (employee ID) and the response body", () => {
    const message =
      "API error 500 at https://qvik.agileday.io/api/v1/time_entry/employee/id/abc-123: Customer X workshop";

    expect(scrubErrorMessage(message)).toBe("API error 500 at <url>");
  });

  it("drops the response body from token errors", () => {
    expect(scrubErrorMessage('Token refresh failed (400): {"error":"invalid_grant"}')).toBe(
      "Token refresh failed (400)"
    );
  });

  it("redacts email addresses", () => {
    expect(scrubErrorMessage("No account for someone@qte.se")).toBe("No account for <email>");
  });

  it("leaves messages without personal detail unchanged", () => {
    expect(scrubErrorMessage("Cannot read properties of undefined")).toBe(
      "Cannot read properties of undefined"
    );
  });
});

describe("scrubExceptionEvent", () => {
  function makeEvent(event: string, properties: Record<string, unknown>): CaptureResult {
    return { uuid: "1", event, properties };
  }

  it("scrubs every exception in the list", () => {
    const event = makeEvent("$exception", {
      $exception_list: [
        { type: "Error", value: "Auth failed (401) at https://x.agileday.io/a/b: secret" },
        { type: "Error", value: "plain" },
      ],
    });

    const result = scrubExceptionEvent(event);

    expect(result?.properties["$exception_list"]).toEqual([
      { type: "Error", value: "Auth failed (401) at <url>" },
      { type: "Error", value: "plain" },
    ]);
  });

  it("passes other events through untouched", () => {
    const event = makeEvent("timer_started", { note: "a: b" });

    expect(scrubExceptionEvent(event)).toEqual(makeEvent("timer_started", { note: "a: b" }));
  });

  it("passes null through", () => {
    expect(scrubExceptionEvent(null)).toBeNull();
  });
});
