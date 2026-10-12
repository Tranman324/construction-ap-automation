import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CommentComposer } from "./CommentComposer";

describe("CommentComposer", () => {
  it("preserves the draft when the post fails", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("offline"); });
    render(<CommentComposer documentId="doc-1" onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(input, { target: { value: "Keep this text" } });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Keep this text"));
    expect(input).toHaveValue("Keep this text");
  });
});
