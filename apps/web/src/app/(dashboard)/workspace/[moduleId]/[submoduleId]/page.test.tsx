import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BlankSubmodulePage from "./page";

describe("BlankSubmodulePage", () => {
  it("renders the requested enabled submodule as a blank slate", async () => {
    const page = await BlankSubmodulePage({
      params: Promise.resolve({ moduleId: "accounting", submoduleId: "ar" }),
    });

    render(page);

    expect(screen.getByText("Accounting")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "AR Invoicing" })).toBeInTheDocument();
    expect(screen.getByText("Blank slate for AR Invoicing.")).toBeInTheDocument();
  });
});