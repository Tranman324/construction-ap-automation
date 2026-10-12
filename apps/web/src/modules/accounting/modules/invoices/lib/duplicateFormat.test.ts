import { describe, expect, it } from "vitest";

import { formatDuplicateDate } from "./duplicateFormat";

describe("formatDuplicateDate", () => {
  it.each([
    ["2026-09-01T00:30:00.000Z", "Sep 1, 2026"],
    ["2026-09-01T23:59:59.000Z", "Sep 1, 2026"],
    ["2026-08-03T14:00:00.000Z", "Aug 3, 2026"],
  ])("formats %s as %s in UTC regardless of the machine zone", (iso, expected) => {
    expect(formatDuplicateDate(iso)).toBe(expected);
  });

  it.each([[null], [undefined], [""], ["not a date"]])("returns null for %j", (value) => {
    expect(formatDuplicateDate(value)).toBeNull();
  });
});
