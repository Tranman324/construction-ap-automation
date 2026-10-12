import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { PageCutControl } from "@/modules/accounting/modules/invoices/components/splits/PageCutControl";

describe("PageCutControl", () => {
  it("calls the cut toggle for cuttable pages", async () => {
    const user = userEvent.setup();
    const onToggleCut = vi.fn();

    render(<PageCutControl page={3} cuttable isCut={false} onToggleCut={onToggleCut} />);
    await user.click(screen.getByRole("button", { name: "Split before page 3" }));

    expect(onToggleCut).toHaveBeenCalledWith(3);
  });

  it("renders only a divider when the page cannot be cut", () => {
    render(<PageCutControl page={1} cuttable={false} isCut={false} onToggleCut={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
