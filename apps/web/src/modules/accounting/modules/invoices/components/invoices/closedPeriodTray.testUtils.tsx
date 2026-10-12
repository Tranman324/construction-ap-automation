import { useState, type ComponentProps } from "react";
import { InvoiceActionBar } from "./InvoiceActionBar";
import { InvoiceResolveTray } from "./InvoiceResolveTray";
import { getInvoiceResolveRows, type ClosedPeriodTrayAction } from "./invoiceResolveModel";
import { PanelNoticeProvider } from "../documents/PanelNotice";

/** Same sibling wiring as the detail page, retaining the real mutation owner. */
export function InvoiceActionBarWithTray(props: ComponentProps<typeof InvoiceActionBar>) {
  const [action, setAction] = useState<ClosedPeriodTrayAction | null>(null);
  const rows = getInvoiceResolveRows(props.invoice, action);
  // Deliberately reuse the mutation owner across invoice IDs: lifecycle tests
  // must prove its generation guards, not merely provider remount protection.
  return <PanelNoticeProvider documentId="reused-action-bar-test-scope">
    <InvoiceResolveTray invoice={props.invoice} rows={rows} discardPending={false} onDiscard={() => false} />
    <div data-testid="approval-footer"><InvoiceActionBar {...props} onClosedPeriodRecoveryChange={setAction} /></div>
  </PanelNoticeProvider>;
}
