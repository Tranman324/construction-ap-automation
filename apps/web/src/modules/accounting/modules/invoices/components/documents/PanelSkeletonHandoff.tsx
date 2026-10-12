"use client";

import type { ReactNode } from "react";
import { DocSkeleton } from "./DocSkeleton";
import { PanelSkeleton, type PanelSkeletonType } from "./PanelSkeleton";
import type { PanelPhaseState } from "./usePanelPhase";
import styles from "./PanelSkeletonHandoff.module.css";

interface PanelSkeletonHandoffProps {
  identity: string;
  phase: PanelPhaseState;
  type: PanelSkeletonType;
  children?: ReactNode;
}

export function PanelSkeletonHandoff({ identity, phase, type, children }: PanelSkeletonHandoffProps) {
  const skeletonVisible = phase.phase === "loading";
  return (
    <div className={styles.root} data-testid="panel-handoff" data-panel-handoff data-panel-identity={identity} data-phase={phase.phase} data-skeleton-visible={skeletonVisible} data-slow-loading={phase.slowLoading || undefined}>
      <div className={styles.content} aria-hidden={skeletonVisible} inert={skeletonVisible || undefined}>{children}</div>
      {skeletonVisible ? (
        <div className={styles.overlay} data-panel-skeleton-overlay role="status" aria-label="Loading document">
          <div className="flex h-full min-h-0 flex-col md:flex-row">
            <div className="min-h-0 flex-1 border-b md:border-b-0 md:border-r"><DocSkeleton /></div>
            <div className="min-h-0 flex-1"><PanelSkeleton type={type} /></div>
          </div>
          {phase.slowLoading ? <p className="sr-only">This is taking longer than expected.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
