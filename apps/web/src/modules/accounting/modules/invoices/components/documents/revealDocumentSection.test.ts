import { afterEach, describe, expect, it } from "vitest";

import { revealDocumentSection } from "./revealDocumentSection";

const original = HTMLElement.prototype.scrollIntoView;
let calls: { node: HTMLElement; options: unknown }[] = [];

function pane(markup: string) {
  calls = [];
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(this: HTMLElement, options?: unknown) { calls.push({ node: this, options }); };
  const root = document.createElement("div");
  root.innerHTML = markup;
  document.body.append(root);
  return root;
}

describe("revealDocumentSection", () => {
  afterEach(() => { HTMLElement.prototype.scrollIntoView = original; document.body.innerHTML = ""; });

  it("scrolls the named field itself (clear of the tray) and focuses it over earlier invalid fields", () => {
    const root = pane('<section data-document-section-id="identity"><h3>Vendor Identity</h3><input id="name" aria-invalid="true"><input id="tax" data-document-field-id="tax-id" aria-invalid="true"></section>');
    expect(revealDocumentSection(root, "identity", "tax-id")).toBe(true);
    expect(calls).toEqual([{ node: root.querySelector("#tax"), options: { block: "center", behavior: "smooth" } }]);
    expect(document.activeElement?.id).toBe("tax");
  });

  it("scrolls the section to the start when there is no field to focus", () => {
    const root = pane('<section data-document-section-id="b"><h3 id="b-heading">B</h3></section>');
    expect(revealDocumentSection(root, "b")).toBe(true);
    expect(calls).toEqual([{ node: root.querySelector("section"), options: { block: "start", behavior: "smooth" } }]);
    expect(document.activeElement?.id).toBe("b-heading");
  });

  it("falls back to the first enabled invalid field, then to the section heading", () => {
    const root = pane('<section data-document-section-id="a"><h3>A</h3><input disabled aria-invalid="true"><select id="pick" aria-invalid="true"></select></section><section data-document-section-id="b"><h3 id="b-heading">B</h3><input aria-invalid="false"></section>');
    revealDocumentSection(root, "a", "absent");
    expect(document.activeElement?.id).toBe("pick");
    revealDocumentSection(root, "b");
    expect(document.activeElement?.id).toBe("b-heading");
    expect(document.activeElement?.getAttribute("tabindex")).toBe("-1");
  });

  it("never reports a section inside a hidden tab panel as revealed", () => {
    const root = pane('<div hidden><section data-document-section-id="identity"><h3>Identity</h3><input aria-invalid="true" /></section></div>');
    expect(revealDocumentSection(root, "identity")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("returns false without scrolling when the section is not rendered", () => {
    const root = pane('<section data-document-section-id="a"><h3>A</h3></section>');
    expect(revealDocumentSection(root, "z")).toBe(false);
    expect(calls).toEqual([]);
  });
});
