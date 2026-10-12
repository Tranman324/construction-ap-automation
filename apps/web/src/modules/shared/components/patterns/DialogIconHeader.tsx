import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/modules/shared/components/ui/dialog";
import { cn } from "@/modules/shared/lib/utils";

export interface DialogIconHeaderProps {
  className?: string;
  description: ReactNode;
  icon: LucideIcon;
  iconClassName?: string;
  title: ReactNode;
  titleClassName?: string;
}

export function DialogIconHeader({
  className,
  description,
  icon: Icon,
  iconClassName,
  title,
  titleClassName,
}: DialogIconHeaderProps) {
  return (
    <DialogHeader className={cn("px-5 pb-2 pt-5 text-left sm:px-6", className)}>
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 rounded-md bg-primary/10 p-2.5 text-primary", iconClassName)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 space-y-1">
          <DialogTitle className={cn("text-base leading-6 sm:text-[17px]", titleClassName)}>
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </div>
      </div>
    </DialogHeader>
  );
}
