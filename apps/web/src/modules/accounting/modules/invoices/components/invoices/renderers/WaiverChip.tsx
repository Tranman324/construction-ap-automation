import {
  InvoiceWaiverChip,
  type InvoiceWaiverChipProps,
} from "./InvoiceMarkerRenderers";

export type WaiverChipProps = InvoiceWaiverChipProps;

/** Backward-compatible name for the canonical invoice waiver renderer. */
export function WaiverChip(props: WaiverChipProps) {
  return <InvoiceWaiverChip {...props} />;
}
