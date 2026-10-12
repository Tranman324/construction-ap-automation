import { describe, expect, it } from "vitest"

import { getInvoiceFieldState, isInvoiceFieldEmpty } from "./invoiceFieldState"

describe("getInvoiceFieldState", () => {
  it.each([
    ["managed fields retain guards without an extra marker", { value: "AI", ownedElsewhere: true, required: true }, "none"],
    ["remove wins over required", { value: "unexpected", mustBeEmpty: true, required: true }, "remove"],
    ["required empty is invalid", { value: "", required: true }, "required"],
    ["optional manual edits are marked", { value: "changed", baseline: "old", optional: true }, "edited"],
    ["changed value is edited", { value: "new", baseline: "old" }, "edited"],
    ["populated unchanged value is unmarked", { value: "same", baseline: "same" }, "none"],
    ["empty optional is marked", { value: "", optional: true }, "optional"],
    ["required empty overrides prior edits", { value: "", baseline: "old", required: true }, "required"],
    ["optional empty overrides prior edits", { value: "", baseline: "old", optional: true }, "optional"],
    ["populated optional unchanged is unmarked", { value: "same", baseline: "same", optional: true }, "none"],
    ["must-empty takes precedence over a changed value", { value: "new", baseline: "old", mustBeEmpty: true }, "remove"],
  ])("applies precedence: %s", (_name, input, marker) => {
    expect(getInvoiceFieldState(input as Parameters<typeof getInvoiceFieldState>[0]).marker).toBe(marker)
  })

  it("distinguishes optional emptiness without making it invalid", () => {
    expect(getInvoiceFieldState({ value: "", baseline: "" })).toMatchObject({ marker: "optional", tone: "gray", ariaInvalid: false })
  })

  it("preserves server manual provenance without overriding value or ownership states", () => {
    expect(getInvoiceFieldState({ value: "saved", baseline: "saved", manuallyEdited: true }).marker).toBe("edited")
    expect(getInvoiceFieldState({ value: "", manuallyEdited: true, required: true }).marker).toBe("required")
    expect(getInvoiceFieldState({ value: "", manuallyEdited: true }).marker).toBe("optional")
    expect(getInvoiceFieldState({ value: "saved", manuallyEdited: true, mustBeEmpty: true }).marker).toBe("remove")
    expect(getInvoiceFieldState({ value: "saved", manuallyEdited: true, ownedElsewhere: true }).marker).toBe("none")
  })

  it("treats whitespace as empty and allows normalized comparisons", () => {
    expect(isInvoiceFieldEmpty("  ")).toBe(true)
    expect(isInvoiceFieldEmpty(0)).toBe(true)
    expect(getInvoiceFieldState({ value: " NEW ", baseline: "new", isEqual: (value, baseline) => value.trim().toLowerCase() === baseline })).toMatchObject({ marker: "none", tone: null })
  })
})
