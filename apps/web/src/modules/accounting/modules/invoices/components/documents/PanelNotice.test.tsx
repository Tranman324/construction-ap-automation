import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PanelNotice, PanelNoticeOutlet, PanelNoticeProvider, usePanelNotices } from "./PanelNotice";

function Counter() {
  const entries = usePanelNotices();
  return <output data-testid="count">{entries.filter((entry) => !entry.resolved).length}</output>;
}

describe("PanelNotice", () => {
  it("leaves non-opted-in consumers inline", () => {
    render(<div data-testid="owner"><PanelNotice id="error" label="Error">Original notice</PanelNotice></div>);
    expect(within(screen.getByTestId("owner")).getByText("Original notice")).toBeVisible();
  });

  it("moves presentation only, retaining owner state and action with no duplicate", () => {
    const run = vi.fn();
    function Owner() {
      const [value, setValue] = useState(0);
      return <div data-testid="owner"><PanelNotice id="error" label="Error"><button onClick={() => { run(); setValue((n) => n + 1); }}>Retry {value}</button></PanelNotice></div>;
    }
    render(<PanelNoticeProvider documentId="A"><Owner /><Counter /><PanelNoticeOutlet /></PanelNoticeProvider>);
    expect(screen.getByTestId("owner")).toBeEmptyDOMElement();
    fireEvent.click(within(screen.getByTestId("panel-notice-outlet")).getByRole("button", { name: "Retry 0" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("button", { name: "Retry 1" })).toHaveLength(1);
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("cleans up only the removed owner and never counts success as unresolved", () => {
    function View({ show, documentId = "A" }: { show: boolean; documentId?: string }) {
      return <PanelNoticeProvider documentId={documentId}>{show && <PanelNotice id="error" label="Error">Failed</PanelNotice>}<PanelNotice id="success" label="Success" resolved>Saved</PanelNotice><Counter /><PanelNoticeOutlet /></PanelNoticeProvider>;
    }
    const view = render(<View show />);
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    view.rerender(<View show={false} />);
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.getByText("Saved")).toBeVisible();
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    view.rerender(<View show={false} documentId="B" />);
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});
