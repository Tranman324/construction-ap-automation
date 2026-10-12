import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { InlineNotice } from "@/modules/shared/components/patterns/InlineNotice";

describe("InlineNotice", () => {
  it("renders titled notice content with tone classes", () => {
    render(
      <InlineNotice tone="warning" role="alert" title="Needs attention">
        Check the failed rows.
      </InlineNotice>,
    );

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Needs attention");
    expect(notice).toHaveTextContent("Check the failed rows.");
    expect(notice).toHaveClass("border-amber-200", "bg-amber-50");
  });

  it("supports actions and iconless compact notices", () => {
    render(
      <InlineNotice tone="success" icon={null} actions={<button type="button">Undo</button>}>
        Saved
      </InlineNotice>,
    );

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
