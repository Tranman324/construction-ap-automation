import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROUTE_MOCKS = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock("next/navigation", () => ({ redirect: ROUTE_MOCKS.redirect }));

import DocumentsPage from "@/app/(dashboard)/accounting/documents/page";

describe("DocumentsPage", () => {
  beforeEach(() => ROUTE_MOCKS.redirect.mockReset());

  it("redirects the legacy list route to the inline Documents tab", () => {
    render(<DocumentsPage />);

    expect(ROUTE_MOCKS.redirect).toHaveBeenCalledWith("/accounting/invoices?status=documents");
  });
});
