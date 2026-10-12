import { describe, expect, it } from "vitest";

import { shouldRetry } from "@/modules/shared/lib/providers";

// The global react-query retry predicate must never retry client errors:
// a 4xx fails identically on retry, and retrying 429s adds read traffic
// exactly when the user is already rate limited.
describe("global query retry predicate", () => {
  it("retries a network/unknown error exactly once", () => {
    expect(shouldRetry(0, new Error("fetch failed"))).toBe(true);
    expect(shouldRetry(1, new Error("fetch failed"))).toBe(false);
  });

  it("retries a 5xx once", () => {
    expect(shouldRetry(0, { status: 500, message: "boom" })).toBe(true);
    expect(shouldRetry(1, { status: 500, message: "boom" })).toBe(false);
  });

  it.each([400, 401, 403, 404, 409, 422, 429])(
    "never retries a %i",
    (status) => {
      expect(shouldRetry(0, { status, message: "client error" })).toBe(false);
    },
  );

  it("preserves the rate-limit message shape it must not retry", () => {
    const rateLimited = { status: 429, message: "Rate limited. Try again in 30 seconds." };
    expect(shouldRetry(0, rateLimited)).toBe(false);
  });
});
