import { expect } from "vitest";

export function expectDomOrder(elements: readonly HTMLElement[]): void {
  for (let index = 1; index < elements.length; index += 1) {
    const previous = elements[index - 1];
    const current = elements[index];
    expect(Boolean(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  }
}

export function expectNoPositiveTabIndex(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[tabindex]")) {
    expect(element.tabIndex).toBeLessThanOrEqual(0);
  }
}
