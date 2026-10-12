import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useCascadingDropdowns } from "@/modules/accounting/modules/invoices/hooks/useCascadingDropdowns";

describe("useCascadingDropdowns", () => {
  it("advances only the successfully saved cascade field baseline", () => {
    const { result } = renderHook(() => useCascadingDropdowns({
      initialVendorCode: "V100",
      initialJobNumber: "J100",
    }));

    act(() => result.current.setVendor("V200"));
    act(() => result.current.acknowledgeSaved("vendorCode", "V200"));

    expect(result.current.hasEdits).toBe(false);
    expect(result.current.changedFields).toEqual({});

    act(() => result.current.setJob("J200"));

    expect(result.current.changedFields).toEqual({ jobNumber: "J200" });
  });

  it("preserves a dirty vendor selection across a vendor refresh while accepting an untouched job", () => {
    const { result, rerender } = renderHook(
      ({ vendor, job }) => useCascadingDropdowns({
        initialVendorCode: vendor,
        initialJobNumber: job,
      }),
      { initialProps: { vendor: "V100", job: "J100" } },
    );

    act(() => result.current.setVendor("V-MANUAL"));
    expect(result.current.vendorCode).toBe("V-MANUAL");
    expect(result.current.dirtyFields.has("vendor")).toBe(true);

    rerender({ vendor: "V200", job: "J200" });

    expect(result.current.vendorCode).toBe("V-MANUAL");
    expect(result.current.jobNumber).toBe("J200");
    expect(result.current.changedFields).toEqual({ vendorCode: "V-MANUAL" });
  });
});
