'use client';

import { useState, useEffect } from 'react';
import { Camera, AlertCircle, Pencil } from 'lucide-react';
import { Checkbox } from '@/modules/shared/components/ui/checkbox';
import { PhotoCapture } from '@/modules/projects/components/detail/PhotoCapture';
import type { ChecklistUserMeta } from '@/modules/projects/components/detail/ChecklistsTab';
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import type { ChecklistItem as ChecklistItemType } from '@/modules/projects/types/checklist';
import { useToggleChecklistItem } from '@/modules/projects/hooks/mutations';
import { MOCK_CURRENT_USER_ID } from '@/modules/projects/mock/index';
import { cn } from '@/modules/shared/lib/utils';

export interface ChecklistItemProps {
  item: ChecklistItemType;
  projectId: string;
  sectionId: string;
  userMetaById: Record<string, ChecklistUserMeta>;
  index?: number;
}

const completionDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function ChecklistItem({ item, userMetaById, index = 0 }: ChecklistItemProps) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [showPhotoWarning, setShowPhotoWarning] = useState(false);
  const [showInputWarning, setShowInputWarning] = useState(false);
  const [done, setDone] = useState(item.is_completed);
  const [inputValue, setInputValue] = useState(item.input_value ?? '');
  const toggleItem = useToggleChecklistItem();

  useEffect(() => {
    if (!showPhotoWarning) return;
    const timer = setTimeout(() => setShowPhotoWarning(false), 2500);
    return () => clearTimeout(timer);
  }, [showPhotoWarning]);

  useEffect(() => {
    if (!showInputWarning) return;
    const timer = setTimeout(() => setShowInputWarning(false), 2500);
    return () => clearTimeout(timer);
  }, [showInputWarning]);

  const needsPhoto = item.requires_photo && photos.length === 0;
  const needsInput = item.requires_input && inputValue.trim() === '';
  const completedBy = item.completed_by
    ? (userMetaById[item.completed_by] ?? { name: 'Unknown teammate' })
    : null;
  const completedAtLabel = item.completed_at
    ? completionDateFormatter.format(new Date(item.completed_at))
    : null;

  function handleCheckedChange() {
    if (needsPhoto) {
      setShowPhotoWarning(true);
      return;
    }
    if (needsInput) {
      setShowInputWarning(true);
      return;
    }
    setDone((prev) => !prev);
    toggleItem.mutate({ itemId: item.id, userId: MOCK_CURRENT_USER_ID });
  }

  function handlePhotoAdded(blobUrl: string, _gps: { lat: number; lng: number } | null) {
    setPhotos((prev) => [...prev, blobUrl]);
    setShowPhotoWarning(false);
  }

  return (
    <li className={cn(
      'flex gap-3 px-4 py-3 transition-colors',
      done && 'bg-emerald-50/40 dark:bg-emerald-950/10',
    )}>
      {/* Row number */}
      <span className={cn(
        'shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold tabular-nums mt-0.5',
        done
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400'
          : 'bg-muted text-muted-foreground',
      )}>
        {index + 1}
      </span>

      {/* Content column */}
      <div className="flex-1 min-w-0 space-y-1.5">
        {/* Item text */}
        <p className={cn(
          'text-sm leading-snug',
          done ? 'text-muted-foreground line-through' : 'text-foreground',
        )}>
          {item.item_text}
        </p>

        {/* Requirement chips */}
        {(item.requires_photo || item.requires_input) && !done && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {item.requires_photo && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
                photos.length > 0
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
              )}>
                <Camera className="h-2.5 w-2.5" />
                {photos.length > 0 ? `${photos.length} photo${photos.length > 1 ? 's' : ''}` : 'Photo required'}
              </span>
            )}
            {item.requires_input && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
                inputValue.trim()
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
              )}>
                <Pencil className="h-2.5 w-2.5" /> {inputValue.trim() ? 'Filled' : 'Input required'}
              </span>
            )}
          </div>
        )}

        {/* Warnings */}
        {(showPhotoWarning || showInputWarning) && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {showPhotoWarning ? 'Attach a photo before completing' : 'Fill in the required field first'}
          </div>
        )}

        {/* Text input */}
        {item.requires_input && (
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={item.input_placeholder || 'Enter details...'}
            disabled={done}
            className={cn(
              'w-full max-w-sm rounded-lg border border-border bg-background px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50',
              'focus:outline-none focus:ring-1 focus:ring-primary/40',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          />
        )}

        {/* Completion meta */}
        {done && (completedBy || completedAtLabel) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {completedBy && <UserAvatar user={completedBy} size="sm" />}
            <span>
              {completedBy ? completedBy.name : 'Completed'}
              {completedAtLabel ? ` · ${completedAtLabel}` : ''}
            </span>
          </div>
        )}

        {/* Photo thumbnails */}
        {photos.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {photos.map((url) => (
              <img
                key={url}
                src={url}
                alt="evidence"
                className="h-12 w-12 object-cover rounded-lg border border-border"
              />
            ))}
          </div>
        )}
      </div>

      {/* Action column */}
      <div className="flex items-start gap-1.5 shrink-0 pt-0.5">
        {item.requires_photo && !done && (
          <PhotoCapture onPhotoAdded={handlePhotoAdded} />
        )}
        <Checkbox
          checked={done}
          disabled={needsPhoto || needsInput}
          onCheckedChange={handleCheckedChange}
          aria-label={item.item_text}
          className={cn(
            'h-5 w-5 rounded',
            done && 'data-[state=checked]:bg-emerald-500 data-[state=checked]:border-emerald-500',
          )}
        />
      </div>
    </li>
  );
}
