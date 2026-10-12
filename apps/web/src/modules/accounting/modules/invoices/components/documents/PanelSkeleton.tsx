"use client";

import { Skeleton } from "@/modules/shared/components/ui/skeleton";

export const PANEL_SKELETON_SHAPES = {
  invoice: { tabs: 4, fields: [1, 2, 1, 2, 2, 1], sections: 2, footer: 3 },
  receipt: { tabs: 3, fields: [1, 2, 2, 1], sections: 2, footer: 2 },
  statement: { tabs: 2, fields: [1, 2, 1], sections: 2, footer: 2 },
  coi: { tabs: 3, fields: [1, 2, 2, 2], sections: 3, footer: 2 },
  w9: { tabs: 2, fields: [1, 2, 2, 1, 1], sections: 3, footer: 2 },
  "lien-waiver": { tabs: 3, fields: [1, 1, 2, 1], sections: 2, footer: 2 },
  subcontract: { tabs: 2, fields: [1, 2, 1, 1], sections: 2, footer: 2 },
  warranty: { tabs: 2, fields: [1, 2, 1], sections: 2, footer: 2 },
  other: { tabs: 2, fields: [1, 1, 2], sections: 2, footer: 2 },
} as const;

export type PanelSkeletonType = keyof typeof PANEL_SKELETON_SHAPES;

export function panelSkeletonTypeForClassification(classification?: string): PanelSkeletonType {
  const normalized = classification?.toLowerCase() as PanelSkeletonType | undefined;
  return normalized && normalized in PANEL_SKELETON_SHAPES ? normalized : "other";
}

interface PanelSkeletonProps {
  type: PanelSkeletonType;
  documentNumber?: string;
}

export function PanelSkeleton({ type, documentNumber }: PanelSkeletonProps) {
  const shape = PANEL_SKELETON_SHAPES[type];
  return (
    <div role="status" aria-live="polite" className="flex h-full min-h-0 flex-col bg-background p-3" data-testid="panel-skeleton">
      <span className="sr-only">Loading {documentNumber ?? "document"}…</span>
      <div data-panel-stage="status" className="flex shrink-0 items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-2"><Skeleton className="h-7 w-24" /><Skeleton className="h-6 w-16" /></div>
        <Skeleton className="h-5 w-20" />
      </div>
      <div data-panel-stage="tabs" className="flex shrink-0 gap-2 border-b py-2">
        {Array.from({ length: shape.tabs }, (_, index) => <Skeleton key={index} className="h-8 flex-1" />)}
      </div>
      <div data-panel-stage="body" className="min-h-0 flex-1 space-y-4 overflow-hidden py-4">
        {shape.fields.map((fieldCount, sectionIndex) => (
          <div key={sectionIndex} className="space-y-2 border-b pb-3">
            <Skeleton className="h-4 w-28" />
            <div className="grid grid-cols-2 gap-3">
              {Array.from({ length: fieldCount }, (_, fieldIndex) => <Skeleton key={fieldIndex} className="h-9 w-full" />)}
            </div>
          </div>
        ))}
      </div>
      <div data-panel-stage="footer" className="flex shrink-0 gap-2 border-t pt-3">
        {Array.from({ length: shape.footer }, (_, index) => <Skeleton key={index} className="h-9 flex-1" />)}
      </div>
    </div>
  );
}
