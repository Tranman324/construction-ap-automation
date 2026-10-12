import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fireSpectrumSubmitConfetti,
  shouldSuppressSpectrumSubmitConfetti,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitConfetti";

function mockMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      addEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      matches,
      media: query,
      onchange: null,
      removeEventListener: vi.fn(),
    })),
  });
}

describe("spectrumSubmitConfetti", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelectorAll("[data-spectrum-submit-confetti]").forEach((element) => {
      element.remove();
    });
  });

  it("suppresses the canvas burst when reduced motion is requested", () => {
    mockMatchMedia(true);

    expect(shouldSuppressSpectrumSubmitConfetti()).toBe(true);
    expect(fireSpectrumSubmitConfetti()).toBe(false);
    expect(document.querySelector("[data-spectrum-submit-confetti]")).not.toBeInTheDocument();
  });
});
