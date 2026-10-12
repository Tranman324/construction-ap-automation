import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatValue, ValueView } from "./resolveCardValue";

describe("formatValue", () => {
  it("VAL-01 formats money as en-US USD with two decimals", () => {
    const cases: Array<[number, string]> = [
      [74877, "$74,877.00"], [9642, "$9,642.00"], [74787, "$74,787.00"], [0, "$0.00"],
      [1500, "$1,500.00"], [1234.5, "$1,234.50"], [-5, "-$5.00"], [0.005, "$0.01"],
    ];
    for (const [value, expected] of cases) {
      expect(formatValue({ kind: "money", value })).toBe(expected);
    }
  });

  it("VAL-02 formats dates in UTC regardless of the local zone", () => {
    const previous = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      // Precondition: the zone really is west of UTC, so a local-time formatter would read Sep 14.
      expect(new Date("2026-09-15T00:00:00Z").getDate()).toBe(14);
      expect(formatValue({ kind: "date", value: "2026-09-15T00:00:00Z" })).toBe("Sep 15, 2026");
      expect(formatValue({ kind: "date", value: "2026-09-14T23:59:59Z" })).toBe("Sep 14, 2026");
      expect(formatValue({ kind: "date", value: "2026-09-27" })).toBe("Sep 27, 2026");
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  it("VAL-03 renders an em dash for null, undefined and invalid dates", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue(undefined)).toBe("—");
    expect(formatValue({ kind: "date", value: "not-a-date" })).toBe("—");
  });

  it("passes strings and text values through verbatim", () => {
    expect(formatValue("Oct 2026")).toBe("Oct 2026");
    expect(formatValue({ kind: "text", value: "Required" })).toBe("Required");
    expect(formatValue({ kind: "mono", value: "53-477" })).toBe("53-477");
  });
});

describe("ValueView", () => {
  it("VAL-04 renders mono text in a monospace element with the muted note after it", () => {
    const { container } = render(<div><ValueView value={{ kind: "mono", value: "53-477", note: "→ 53477" }} /></div>);
    const [value, note] = Array.from(container.querySelectorAll("span"));
    expect(value.textContent).toBe("53-477");
    expect(value.className).toContain("font-mono");
    expect(note.textContent).toBe("→ 53477");
    expect(note.className).toContain("text-muted-foreground");
    expect(value.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("VAL-04 renders plain strings and text values without a note or monospace", () => {
    const { container } = render(<div><ValueView value="Oct 2026" /><ValueView value={{ kind: "text", value: "Required" }} /></div>);
    const spans = Array.from(container.querySelectorAll("span"));
    expect(spans.map((s) => s.textContent)).toEqual(["Oct 2026", "Required"]);
    expect(spans.every((s) => !s.className.includes("font-mono"))).toBe(true);
  });

  it("VAL-05 renders money through the formatter in a monospace element", () => {
    const { container } = render(<div><ValueView value={{ kind: "money", value: 9642 }} /></div>);
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("$9,642.00");
    expect(span?.className).toContain("tabular-nums");
  });

  it("renders null as a muted em dash", () => {
    const { container } = render(<div><ValueView value={null} /></div>);
    const span = container.querySelector("span");
    expect(span?.textContent).toBe("—");
    expect(span?.className).toContain("text-muted-foreground");
  });
});
