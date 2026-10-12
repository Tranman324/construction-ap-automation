"use client";

import { type ReactNode, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Clock3, FileText, ListChecks, MailX, Settings as SettingsIcon, Trash2 } from "lucide-react";

import { DocumentTypesSection } from "@/modules/accounting/modules/invoices/components/settings/DocumentTypesSection";
import { IgnoreRulesPanel } from "@/modules/accounting/modules/invoices/components/settings/IgnoreRulesPanel";
import { RetentionPoliciesSection } from "@/modules/accounting/modules/invoices/components/settings/RetentionPoliciesSection";
import { RulesWorkspaceSurface } from "@/modules/accounting/modules/invoices/components/settings/RulesWorkspaceSurface";
import { StaleCleanupSection } from "@/modules/accounting/modules/invoices/components/settings/StaleCleanupSection";
import { useClassifications } from "@/modules/accounting/modules/invoices/hooks/queries";
import { useRules } from "@/modules/accounting/modules/invoices/hooks/useRules";
import { Button } from "@/modules/shared/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/modules/shared/components/ui/dialog";
import { cn } from "@/modules/shared/lib/utils";

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsSectionId = "rules" | "retention" | "stale" | "documentTypes";

interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  subtitle: string;
  icon: LucideIcon;
}

export function SettingsPanel({ open, onOpenChange }: SettingsPanelProps) {
  const [ignoreRulesOpen, setIgnoreRulesOpen] = useState(false);
  const [selectedSection, setSelectedSection] = useState<SettingsSectionId>("rules");
  const { data: rulesData } = useRules();
  const { classifications } = useClassifications();
  const activeRulesCount = rulesData?.rules.filter((rule) => rule.isActive).length ?? 0;
  const documentTypesCount = classifications.length;
  const sections: SettingsSection[] = [
    { id: "rules", label: "Auto-coding Rules", subtitle: `${activeRulesCount} active`, icon: ListChecks },
    { id: "retention", label: "Retention Policies", subtitle: "Purge windows", icon: Trash2 },
    { id: "stale", label: "Stale Cleanup", subtitle: "Pending → discarded", icon: Clock3 },
    { id: "documentTypes", label: "Document Types", subtitle: `${documentTypesCount} mappings`, icon: FileText },
  ];

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) setIgnoreRulesOpen(false);
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex h-[min(820px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-[1280px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1280px]">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <SettingsIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base">Settings</DialogTitle>
              <DialogDescription className="mt-1 text-xs">Invoices · automation and document lifecycle</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] bg-muted/20">
          <nav aria-label="Settings sections" className="border-r p-3">
            <div className="flex flex-col gap-1">
              {sections.map((section) => (
                <SettingsRailItem
                  key={section.id}
                  section={section}
                  active={selectedSection === section.id}
                  onSelect={() => setSelectedSection(section.id)}
                />
              ))}
            </div>
          </nav>
          <div className="min-h-0 bg-background">
            <SettingsPane active={selectedSection === "rules"} id="rules-pane">
              <RulesSettingsPane active={selectedSection === "rules"} />
            </SettingsPane>
            <SettingsPane active={selectedSection === "retention"} id="retention-pane">
              <RetentionSettingsPane onOpenIgnoreRules={() => setIgnoreRulesOpen(true)} />
            </SettingsPane>
            <SettingsPane active={selectedSection === "stale"} id="stale-pane">
              <StaleCleanupSettingsPane />
            </SettingsPane>
            <SettingsPane active={selectedSection === "documentTypes"} id="document-types-pane">
              <DocumentTypesSection />
            </SettingsPane>
          </div>
        </div>

        <DialogFooter className="border-t px-5 py-3 sm:justify-end">
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>

        <IgnoreRulesPanel open={ignoreRulesOpen} onOpenChange={setIgnoreRulesOpen} />
      </DialogContent>
    </Dialog>
  );
}

function SettingsRailItem({ section, active, onSelect }: { section: SettingsSection; active: boolean; onSelect: () => void }) {
  const Icon = section.icon;

  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors",
        active ? "border-l-primary bg-card text-primary shadow-sm" : "border-l-transparent text-foreground hover:bg-card/70",
      )}
      onClick={onSelect}
    >
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors",
          active ? "bg-primary/10 text-primary" : "group-hover:text-foreground",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap text-sm font-semibold">{section.label}</span>
        <span className="block whitespace-nowrap text-xs font-medium text-muted-foreground">{section.subtitle}</span>
      </span>
    </button>
  );
}

function SettingsPane({ active, id, children }: { active: boolean; id: string; children: ReactNode }) {
  return (
    <div id={id} hidden={!active} aria-hidden={!active} className={cn("h-full min-h-0", !active && "hidden")}>
      {children}
    </div>
  );
}

function RulesSettingsPane({ active }: { active: boolean }) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Auto-coding Rules</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Run top-to-bottom on every incoming invoice. Reorder, edit, and create rules here.
          </p>
        </div>
      </div>
      <RulesWorkspaceSurface active={active} />
    </section>
  );
}

function RetentionSettingsPane({ onOpenIgnoreRules }: { onOpenIgnoreRules: () => void }) {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-base font-semibold">Retention Policies</h3>
          <p className="mt-1 text-sm text-muted-foreground">Manage purge windows and recurring unwanted email traffic.</p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 gap-2" onClick={onOpenIgnoreRules}>
          <MailX className="h-4 w-4" />
          Ignore Rules
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <RetentionPoliciesSection />
      </div>
    </section>
  );
}

function StaleCleanupSettingsPane() {
  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="border-b px-5 py-4">
        <h3 className="text-base font-semibold">Stale Cleanup</h3>
        <p className="mt-1 text-sm text-muted-foreground">Auto-discard non-invoice documents that sit in pending beyond their cleanup window.</p>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        <StaleCleanupSection />
      </div>
    </section>
  );
}
