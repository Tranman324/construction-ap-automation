// ─── Shared pattern components ───────────────────────────────────────────────
// Import from here: "@/modules/shared/components/patterns"

// Form patterns
export { Field } from "./Field"
export type { FieldProps } from "./Field"
export { getInvoiceFieldState, isInvoiceFieldEmpty } from "./invoiceFieldState"
export type { InvoiceFieldMarker, InvoiceFieldState, InvoiceFieldStateInput } from "./invoiceFieldState"

export { FormPage, FormSection } from "./FormSection"
export type { FormPageProps, FormSectionProps } from "./FormSection"

export { SaveBar } from "./SaveBar"
export type { SaveBarProps } from "./SaveBar"

// DS layout patterns
export { MetricCard } from "./MetricCard"
export type { MetricCardProps, MetricTone, MetricDelta } from "./MetricCard"

export { StatGrid } from "./StatGrid"
export type { StatGridProps } from "./StatGrid"

export { DataTablePattern } from "./DataTablePattern"
export type {
  DataTablePatternProps, DataTableTab, DataTableSearch,
  DataTableTrash, DataTableSelection,
} from "./DataTablePattern"

export { CompactStatGrid } from "./CompactStatGrid"
export type { CompactStatGridProps, CompactStatItem } from "./CompactStatGrid"

export { DialogIconHeader } from "./DialogIconHeader"
export type { DialogIconHeaderProps } from "./DialogIconHeader"

export { FilterSummaryBar } from "./FilterSummaryBar"
export type { FilterSummaryBarProps } from "./FilterSummaryBar"

export { InlineNotice } from "./InlineNotice"
export type { InlineNoticeProps, InlineNoticeTone } from "./InlineNotice"

export { PlatformSectionHeader } from "./PlatformSectionHeader"
export type { PlatformSectionHeaderProps } from "./PlatformSectionHeader"

export { ScrollableList, ScrollableListRow } from "./ScrollableList"
export type { ScrollableListProps, ScrollableListRowProps } from "./ScrollableList"

export { StatusPanel } from "./StatusPanel"
export type { StatusPanelProps, StatusPanelTone } from "./StatusPanel"

export { DetailPage } from "./DetailPage"
export type {
  DetailPageProps, DetailPaging, DetailMetaItem, DetailTab,
} from "./DetailPage"

export { SURFACE_MOTION_CONTRACTS, getSurfaceMotionClassName, getSurfaceMotionStyles } from "./SurfaceMotion"
export type { SurfaceMotionPreset, SurfaceMotionState } from "./SurfaceMotion"

export { CardStack } from "./CardStack"
export type { CardStackProps, CardStackRenderContext } from "./CardStack"
export { ResolveTray } from "./ResolveTray"
export type { ResolveTrayProps, ResolveTrayRow } from "./ResolveTray"
