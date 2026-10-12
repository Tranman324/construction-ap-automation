import { describe, expect, it } from "vitest";

import { mutationErrorMessage } from "@/modules/accounting/modules/invoices/lib/mutationErrorMessage";

describe("mutationErrorMessage", () => {
  it("preserves a plain API error message", () => {
    expect(mutationErrorMessage({ status: 422, message: "Server validation message" }, "Fallback")).toBe("Server validation message");
  });
});
