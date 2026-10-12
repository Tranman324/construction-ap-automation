"use client";

import { Check, Pin, PinOff } from "lucide-react";
import { Button } from "@/modules/shared/components/ui/button";
import type { ResolvedModuleRegistryModule } from "@/modules/shared/lib/moduleRegistry";
import { cn } from "@/modules/shared/lib/utils";
import { isLiveSidebarSubmodule, type SidebarPanelUser } from "./sidebarPanel.types";

interface SidebarPanelProps {
  module: ResolvedModuleRegistryModule;
  activeSubmoduleId?: string;
  currentDefaultSubmoduleId?: string;
  isPinned: boolean;
  user: SidebarPanelUser;
  onTogglePinned: () => void;
  onNavigateSubmodule: (moduleId: string, submoduleId: string, href: string) => void;
  onSetDefaultSubmodule: (moduleId: string, submoduleId: string) => void;
}

export function SidebarPanel({
  module,
  activeSubmoduleId,
  currentDefaultSubmoduleId,
  isPinned,
  user,
  onTogglePinned,
  onNavigateSubmodule,
  onSetDefaultSubmodule,
}: SidebarPanelProps) {
  const resolvedDefaultSubmoduleId = currentDefaultSubmoduleId ?? module.defaultSubmodule;
  const PinIcon = isPinned ? PinOff : Pin;

  return (
    <aside className="tbx-v3__panel">
      <div className="tbx-v3__panel-head">
        <span className="tbx-v3__wordmark" role="img" aria-label="Toolbox" />
      </div>

      <div className="tbx-v3__module-title">
        <div className="tbx-v3__module-name-wrap">
          <h2 className="tbx-v3__module-name">{module.label}</h2>
        </div>
        <div className="tbx-v3__module-actions">
          <Button
            type="button"
            variant={isPinned ? "secondary" : "ghost"}
            size="icon"
            onClick={onTogglePinned}
            aria-label={isPinned ? "Pinned" : "Pin"}
            aria-pressed={isPinned}
            className="tbx-v3__pin-button"
          >
            <PinIcon className={cn("h-3.5 w-3.5", isPinned ? "text-primary" : "text-muted-foreground")} />
          </Button>
        </div>
      </div>

      <div className="tbx-v3__panel-body">
        {module.children.map((submodule) => {
          const isActive = activeSubmoduleId === submodule.id;
          const isDefault = resolvedDefaultSubmoduleId === submodule.id;
          const isLive = isLiveSidebarSubmodule(submodule);

          return (
            <button
              key={submodule.id}
              type="button"
              disabled={!isLive}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                if (isLive) {
                  onNavigateSubmodule(module.id, submodule.id, submodule.href);
                }
              }}
              onContextMenu={(event) => {
                if (!isLive) {
                  return;
                }

                event.preventDefault();
                onSetDefaultSubmodule(module.id, submodule.id);
              }}
              title={isLive ? "Right-click to set as default on open" : undefined}
              className={cn("tbx-v3__item", isActive && "is-active", !isLive && "is-disabled")}
            >
              <span className="tbx-v3__item-icon">
                <submodule.icon className="h-[17px] w-[17px]" />
              </span>
              <span className="tbx-v3__item-label">{submodule.label}</span>
              <span className="tbx-v3__item-meta">
                {isDefault ? <Check className="tbx-v3__default-marker" aria-label="Default on open" /> : null}
                {submodule.attention ? <span className="tbx-v3__attn-dot" aria-label={`${submodule.label} needs attention`} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="tbx-v3__panel-footer">
        <div className="tbx-v3__foot-info">
          <p className="tbx-v3__foot-name">{user.name}</p>
          <p className="tbx-v3__foot-role">{user.position ?? user.email}</p>
        </div>
      </div>
    </aside>
  );
}