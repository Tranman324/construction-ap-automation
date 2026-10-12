'use client';

import { useState } from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/modules/shared/components/ui/tooltip';
import { cn } from '@/modules/shared/lib/utils';

// ─── Size Config ──────────────────────────────────────────────────────────────

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<AvatarSize, { container: string; text: string }> = {
  xs: { container: 'h-5 w-5', text: 'text-[9px]' },
  sm: { container: 'h-6 w-6', text: 'text-[10px]' },
  md: { container: 'h-8 w-8', text: 'text-xs' },
  lg: { container: 'h-10 w-10', text: 'text-sm' },
  xl: { container: 'h-[72px] w-[72px]', text: 'text-lg' },
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? '';
  const second = parts[1]?.[0] ?? '';
  return (first + second).toUpperCase();
}

// ─── UserAvatar ───────────────────────────────────────────────────────────────

interface UserAvatarProps {
  user: { name: string; image?: string | null };
  size?: AvatarSize;
  className?: string;
}

export function UserAvatar({ user, size = 'md', className }: UserAvatarProps) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const { container, text } = sizeClasses[size];
  const initials = getInitials(user.name);
  const showImage = !!user.image && failedImageUrl !== user.image;

  const avatar = showImage ? (
    <img
      src={user.image as string}
      alt={user.name}
      className={cn('rounded-full object-cover', container, className)}
      onError={() => setFailedImageUrl(user.image ?? null)}
    />
  ) : (
    <div
      className={cn(
        'rounded-full bg-gradient-to-br from-ncg-navy to-ncg-cyan flex items-center justify-center',
        container,
        className,
      )}
    >
      <span className={cn('text-white font-semibold', text)}>{initials}</span>
    </div>
  );

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{avatar}</TooltipTrigger>
        <TooltipContent>{user.name}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── AvatarGroup ──────────────────────────────────────────────────────────────

interface AvatarGroupProps {
  users: Array<{ name: string; image?: string | null }>;
  max?: number;
  size?: AvatarSize;
  className?: string;
}

export function AvatarGroup({ users, max = 3, size = 'md', className }: AvatarGroupProps) {
  const visible = users.slice(0, max);
  const overflow = users.length - max;
  const { container, text } = sizeClasses[size];

  return (
    <div className={cn('flex -space-x-2', className)}>
      {visible.map((user) => (
        <UserAvatar
          key={user.name}
          user={user}
          size={size}
          className="ring-2 ring-background"
        />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            'rounded-full bg-muted text-muted-foreground flex items-center justify-center ring-2 ring-background',
            container,
          )}
        >
          <span className={cn('font-semibold', text)}>+{overflow}</span>
        </div>
      )}
    </div>
  );
}
