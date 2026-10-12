'use client';

import { useState } from 'react';
import { cn } from '@/modules/shared/lib/utils';
import { Button } from '@/modules/shared/components/ui/button';
import { Checkbox } from '@/modules/shared/components/ui/checkbox';
import { Input } from '@/modules/shared/components/ui/input';
import { Plus, Trash2 } from 'lucide-react';
import type { SubcontractorLienWaiver } from '@/modules/projects/types/closeout';

interface LienWaiverTableProps {
  waivers: SubcontractorLienWaiver[];
  onToggle?: (waiverId: string) => void;
  onAdd?: (name: string) => void;
  onRemove?: (waiverId: string) => void;
  className?: string;
}

export function LienWaiverTable({ waivers, onToggle, onAdd, onRemove, className }: LienWaiverTableProps) {
  const [newName, setNewName] = useState('');
  const received = waivers.filter((w) => w.received).length;

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (!trimmed || !onAdd) return;
    onAdd(trimmed);
    setNewName('');
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subcontractor Lien Waivers</h4>
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground">{received}/{waivers.length}</span>
      </div>

      {waivers.length === 0 ? (
        <p className="text-xs text-muted-foreground italic py-2">No lien waivers tracked yet.</p>
      ) : (
        <div className="grid gap-0.5">
          {waivers.map((w) => (
            <div
              key={w.id}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors duration-150',
                'hover:bg-muted/40 group',
              )}
            >
              <Checkbox
                checked={w.received}
                onCheckedChange={onToggle ? () => onToggle(w.id) : undefined}
                className="size-3.5"
              />
              <span className={cn('flex-1 text-sm', w.received && 'text-muted-foreground line-through opacity-70')}>
                {w.subcontractorName}
              </span>
              {onRemove && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => onRemove(w.id)}
                >
                  <Trash2 className="size-3 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {onAdd && (
        <div className="flex gap-2 pt-1">
          <Input
            placeholder="Subcontractor name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className="h-7 text-xs"
          />
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs shrink-0" onClick={handleAdd} disabled={!newName.trim()}>
            <Plus className="size-3 mr-1" /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
