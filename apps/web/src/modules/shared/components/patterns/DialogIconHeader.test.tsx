import { UploadCloud } from "lucide-react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DialogIconHeader } from "@/modules/shared/components/patterns/DialogIconHeader";
import { Dialog, DialogContent } from "@/modules/shared/components/ui/dialog";

describe("DialogIconHeader", () => {
  it("renders dialog title and description with icon shell", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogIconHeader
            icon={UploadCloud}
            title="Submit invoices"
            description="Posts selected invoices to Spectrum."
          />
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText("Submit invoices")).toBeInTheDocument();
    expect(screen.getByText("Posts selected invoices to Spectrum.")).toBeInTheDocument();
  });
});
