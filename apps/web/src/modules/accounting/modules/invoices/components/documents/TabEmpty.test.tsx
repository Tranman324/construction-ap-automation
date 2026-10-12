import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TabEmpty } from "./TabEmpty";

describe("TabEmpty", () => {
  it("renders the default empty copy", () => {
    render(<TabEmpty />);
    expect(screen.getByText("No documents")).toBeInTheDocument();
    expect(screen.getByText("This invoice doesn't have any attached documents yet.")).toBeInTheDocument();
  });

  it("renders custom copy and invokes its action", async () => {
    const onAction = vi.fn();
    render(<TabEmpty title="No files" description="Attach a file to continue." actionLabel="Attach" onAction={onAction} />);
    expect(screen.getByText("No files")).toBeInTheDocument();
    expect(screen.getByText("Attach a file to continue.")).toBeInTheDocument();
    screen.getByRole("button", { name: "Attach" }).click();
    expect(onAction).toHaveBeenCalledOnce();
  });
});
