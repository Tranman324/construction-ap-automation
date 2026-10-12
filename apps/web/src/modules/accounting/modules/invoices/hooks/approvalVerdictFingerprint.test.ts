import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makeMutationWrapper } from "@/modules/accounting/modules/invoices/hooks/mutations.testUtils";
import {
  approvalVerdictFingerprint,
  approvalVerdictQueryKey,
  useValidateApproval,
} from "@/modules/accounting/modules/invoices/hooks/queries";
import type { Invoice } from "@/modules/accounting/modules/invoices/types/invoice";

// The validate-approval query key embeds this fingerprint so that persisting an
// edit to a verdict-relevant field triggers a refetch, while unrelated changes
// do not needlessly refetch the money-path verdict.

function base(): Invoice {
  return {
    id: "inv-1",
    file: "a.pdf",
    matching: {
      vendor: { vendorCode: "V001" },
      job: { jobNumber: "25-401" },
      subcontract: { subcontractNumber: "25-401.01" },
    },
    extracted: { amount: 100 },
    gl_account: "5450",
    cost_type: "S",
  } as unknown as Invoice;
}

describe("approvalVerdictFingerprint (refetch-on-edit key)", () => {
  it("uses the exact seeded key on the next render for the returned snake-case row", () => {
    const invoice = Object.assign(base(), {
      id: "invoice-seeded",
      gl_account: "5450",
      gl_date: "2026-07-20",
    });
    const { queryClient, Wrapper } = makeMutationWrapper();

    renderHook(() => useValidateApproval(invoice, { enabled: false }), { wrapper: Wrapper });

    expect(queryClient.getQueryCache().find({
      queryKey: approvalVerdictQueryKey(invoice),
      exact: true,
    })?.queryKey).toEqual([
      "validate-approval",
      "invoice-seeded",
      approvalVerdictFingerprint(invoice),
    ]);
  });

  it("changes when a verdict-relevant saved field changes (gl_account)", () => {
    const before = approvalVerdictFingerprint(base());
    const after = approvalVerdictFingerprint(
      Object.assign(base() as object, { gl_account: "5300" }) as unknown as Invoice,
    );
    expect(after).not.toBe(before);
  });

  it("changes when the matched subcontract changes", () => {
    const before = approvalVerdictFingerprint(base());
    const invoice = base();
    invoice.matching!.subcontract = { subcontractNumber: "25-401.02" } as never;
    expect(approvalVerdictFingerprint(invoice)).not.toBe(before);
  });

  it("is stable when an unrelated field changes (no needless refetch)", () => {
    const before = approvalVerdictFingerprint(base());
    const invoice = Object.assign(base() as object, { file: "different.pdf" }) as unknown as Invoice;
    expect(approvalVerdictFingerprint(invoice)).toBe(before);
  });
});
