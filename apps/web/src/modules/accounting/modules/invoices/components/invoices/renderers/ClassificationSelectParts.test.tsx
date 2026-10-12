import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ClassificationSelectItem,
  ClassificationSelectValue,
} from "@/modules/accounting/modules/invoices/components/invoices/renderers/ClassificationSelectParts";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";

describe("ClassificationSelectParts", () => {
  it("renders iconized options that can still be selected", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();

    render(
      <Select value="invoice" onValueChange={onValueChange}>
        <SelectTrigger aria-label="Document type">
          <SelectValue>
            <ClassificationSelectValue classification="invoice" label="Invoice" />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <ClassificationSelectItem classification="invoice" label="Invoice" />
          <ClassificationSelectItem classification="receipt" label="Receipt" />
        </SelectContent>
      </Select>,
    );

    await user.click(screen.getByRole("combobox", { name: "Document type" }));
    await user.click(screen.getByRole("option", { name: "Receipt" }));

    expect(onValueChange).toHaveBeenCalledWith("receipt");
  });
});
