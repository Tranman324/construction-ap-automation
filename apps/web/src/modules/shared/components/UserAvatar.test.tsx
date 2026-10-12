import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { UserAvatar } from "@/modules/shared/components/UserAvatar";

describe("UserAvatar", () => {
  it("renders the extra-large profile image size", () => {
    render(<UserAvatar user={{ name: "Dana Whitfield", image: "/profile.jpg" }} size="xl" />);

    expect(screen.getByRole("img", { name: "Dana Whitfield" })).toHaveClass("h-[72px]", "w-[72px]");
  });

  it("falls back to initials when the image reports an error", () => {
    render(<UserAvatar user={{ name: "Jordan Tran", image: "/missing-photo.jpg" }} />);

    fireEvent.error(screen.getByRole("img", { name: "Jordan Tran" }));

    expect(screen.queryByRole("img", { name: "Jordan Tran" })).not.toBeInTheDocument();
    expect(screen.getByText("JT")).toBeInTheDocument();
  });

  it("renders initials immediately when no image URL is available", () => {
    render(<UserAvatar user={{ name: "Jordan Tran", image: null }} />);

    expect(screen.getByText("JT")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("retries a new identity URL after a previous image failure", () => {
    const { rerender } = render(<UserAvatar user={{ name: "Jordan Tran", image: "/old-photo.jpg" }} />);

    fireEvent.error(screen.getByRole("img", { name: "Jordan Tran" }));
    expect(screen.getByText("JT")).toBeInTheDocument();

    rerender(<UserAvatar user={{ name: "Dana Whitfield", image: "/new-photo.jpg" }} />);

    expect(screen.getByRole("img", { name: "Dana Whitfield" })).toHaveAttribute("src", "/new-photo.jpg");
    expect(screen.queryByText("JT")).not.toBeInTheDocument();
  });
});
