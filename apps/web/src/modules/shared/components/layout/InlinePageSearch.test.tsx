import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { InlinePageSearch } from "./InlinePageSearch";

function SearchHarness() {
  const [value, setValue] = useState("");

  return (
    <>
      <InlinePageSearch
        ariaLabel="Search projects"
        onValueChange={setValue}
        placeholder="Search projects..."
        value={value}
      />
      <span data-testid="search-value">{value}</span>
    </>
  );
}

describe("InlinePageSearch", () => {
  it("updates the controlled value and clears it from the inline action", async () => {
    const user = userEvent.setup();

    render(<SearchHarness />);

    const input = screen.getByRole("textbox", { name: /search projects/i });

    await user.type(input, "alpha");

    expect(screen.getByTestId("search-value")).toHaveTextContent("alpha");

    await user.click(screen.getByRole("button", { name: /clear search/i }));

    expect(screen.getByTestId("search-value")).toHaveTextContent("");
  });
});