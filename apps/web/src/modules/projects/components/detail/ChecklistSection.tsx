'use client';

import { useState } from 'react';
import { ChevronDown, CheckCircle2, Camera, Pencil } from 'lucide-react';
import { AvatarGroup, UserAvatar } from '@/modules/shared/components/UserAvatar';
import type { ChecklistUserMeta } from '@/modules/projects/components/detail/ChecklistsTab';
import { cn } from '@/modules/shared/lib/utils';
import { ChecklistItem } from '@/modules/projects/components/detail/ChecklistItem';
import type { ChecklistSection as ChecklistSectionType } from '@/modules/projects/types/checklist';

export interface ChecklistSectionProps {
  section: ChecklistSectionType;
  projectId: string;
  userMetaById: Record<string, ChecklistUserMeta>;
  defaultOpen?: boolean;
  progressPct: number;
  progressDone: number;
  progressTotal: number;
  isComplete: boolean;
  ringColor: string;
  accentColor: string;
}

function getSectionCompletedUsers(
  section: ChecklistSectionType,
  userMetaById: Record<string, ChecklistUserMeta>,
): ChecklistUserMeta[] {
  const completedBy = Array.from(
    new Set(
      section.items
        .filter((item) => item.is_completed && item.completed_by)
        .map((item) => item.completed_by as string),
    ),
  );

  return completedBy.map((userId) => userMetaById[userId] ?? { name: 'Unknown teammate' });
}

export function ChecklistSection({
  section,
  projectId,
  userMetaById,
  defaultOpen = false,
  progressPct,
  progressDone,
  progressTotal,
  isComplete,
  ringColor,
  accentColor,
}: ChecklistSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const completedUsers = getSectionCompletedUsers(section, userMetaById);
  const photoCount = section.items.filter((i) => i.requires_photo).length;
  const inputCount = section.items.filter((i) => i.requires_input).length;

  return (
    <div className={cn(
      'rounded-xl border overflow-hidden transition-[background-color,border-color]',
      isComplete
        ? 'border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/30 dark:bg-emerald-950/10'
        : 'border-border bg-card',
    )}>
      {/* Section header */}
      <button
        type="button"
        className="w-full flex items-center gap-3 sm:gap-4 p-4 cursor-pointer hover:bg-muted/20 dark:hover:bg-muted/5 transition-colors"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        {/* Mini progress ring */}
        <div className="relative shrink-0">
          <svg viewBox="0 0 36 36" className="h-9 w-9">
            <circle
              cx="18" cy="18" r="15.5"
              fill="none" strokeWidth="2.5"
              className="stroke-muted"
            />
            <circle
              cx="18" cy="18" r="15.5"
              fill="none" strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${progressPct * 0.974} 100`}
              transform="rotate(-90 18 18)"
              className={cn(
                'transition-[stroke,stroke-dasharray] duration-500',
                isComplete ? 'stroke-emerald-500' : ringColor,
              )}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {isComplete ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <span className="text-[10px] font-bold tabular-nums text-muted-foreground">{progressPct}</span>
            )}
          </div>
        </div>

        {/* Title + meta */}
        <div className="min-w-0 flex-1 text-left">
          <p className={cn(
            'text-sm font-semibold truncate',
            isComplete ? 'text-emerald-700 dark:text-emerald-400' : 'text-foreground',
          )}>
            {section.title}
          </p>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {progressDone}/{progressTotal} items
            </span>
            {photoCount > 0 && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                · <Camera className="h-2.5 w-2.5" /> {photoCount}
              </span>
            )}
            {inputCount > 0 && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                · <Pencil className="h-2.5 w-2.5" /> {inputCount}
              </span>
            )}
          </div>
        </div>

        {/* Completed-by avatars */}
        {completedUsers.length > 0 && (
          <div className="hidden sm:block shrink-0">
            {completedUsers.length === 1 ? (
              <UserAvatar user={completedUsers[0]} size="sm" />
            ) : (
              <AvatarGroup users={completedUsers} size="sm" max={3} />
            )}
          </div>
        )}

        {/* Expand chevron */}
        <ChevronDown
          className={cn(
            'h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Expanded items */}
      {open && (
        <div className="border-t border-border bg-background/50 dark:bg-background/20">
          {/* Horizontal progress bar */}
          <div className="h-0.5 w-full bg-muted">
            <div
              className={cn(
                'h-full transition-[width,background-color] duration-500 rounded-r-full',
                isComplete ? 'bg-emerald-500' : 'bg-primary',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <ul className="divide-y divide-border/50">
            {section.items.map((item, idx) => (
              <ChecklistItem
                key={item.id}
                item={item}
                projectId={projectId}
                sectionId={section.title}
                userMetaById={userMetaById}
                index={idx}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
