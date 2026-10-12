"use client";

import { useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import type { RuleAction, RuleActionType } from "@/modules/accounting/modules/invoices/types/rules";
import type { PhaseCodeOption, RoutingCodeOption } from "@/modules/accounting/modules/invoices/types/api";
import {
  ACTION_SUBTITLES,
  VALUELESS_ACTIONS,
} from "@/modules/accounting/modules/invoices/components/settings/ruleActionBehavior";
import {
  useClassifications,
  useCostTypes,
  usePhaseCodes,
  useRoutingCodes,
  useRuleOptions,
} from "@/modules/accounting/modules/invoices/hooks/queries";
import { JobDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/JobDropdown";
import { VendorDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/VendorDropdown";
import { GlAccountDropdown } from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/GlAccountDropdown";
import {
  Check,
  CommandItem,
  ComboboxShell,
} from "@/modules/accounting/modules/invoices/components/invoices/dropdowns/ComboboxShell";
import { PermissionGate } from "@/modules/shared/components/PermissionGate";
import { Input } from "@/modules/shared/components/ui/input";
import { cn } from "@/modules/shared/lib/utils";

// ─── Props ────────────────────────────────────────────────────────────

interface RuleActionRowProps {
  action: RuleAction;
  onChange: (updated: RuleAction) => void;
  onRemove: () => void;
  showRemove: boolean;
}

// ─── Component ───────────────────────────────────────────────────────────

export function RuleActionRow({ action, onChange, onRemove, showRemove }: RuleActionRowProps) {
  const { type, value } = action;
  const { data: ruleOptions } = useRuleOptions();
  const isValueless = VALUELESS_ACTIONS.has(type);
  const subtitle = ACTION_SUBTITLES[type];
  const [actionOpen, setActionOpen] = useState(false);
  const [actionSearch, setActionSearch] = useState("");
  const sortedActionOptions = useMemo(
    () =>
      (ruleOptions?.actions ?? [])
        .map((option) => ({ value: option.value as RuleActionType, label: option.label }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    [ruleOptions],
  );
  const actionLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const option of ruleOptions?.actions ?? []) map[option.value] = option.label;
    return map;
  }, [ruleOptions]);
  const actionLabel = (actionType: RuleActionType) => actionLabelMap[actionType] ?? actionType;
  const filteredActionOptions = useMemo(() => {
    const term = actionSearch.trim().toLowerCase();
    return term
      ? sortedActionOptions.filter((option) => option.label.toLowerCase().includes(term))
      : sortedActionOptions;
  }, [actionSearch, sortedActionOptions]);

  function setType(newType: RuleActionType) {
    const needsValue = !VALUELESS_ACTIONS.has(newType);
    onChange(needsValue ? { type: newType, value: "" } : { type: newType });
    setActionOpen(false);
    setActionSearch("");
  }

  function renderValueInput() {
    if (isValueless) return null;

    const setValue = (next: string) => onChange({ type, value: next });
    const clearValue = () => onChange({ type, clear: true });
    const clearPlaceholder = action.clear ? "Clear value" : undefined;

    if (type === "set_vendor") return <PickerFrame><VendorDropdown value={value || null} clearOptionLabel="Clear value" placeholder={clearPlaceholder} onChange={(next) => next ? setValue(next) : clearValue()} /></PickerFrame>;
    if (type === "set_job") return <PickerFrame><JobDropdown value={value || null} clearOptionLabel="Clear value" placeholder={clearPlaceholder} onChange={(next) => next ? setValue(next) : clearValue()} /></PickerFrame>;
    if (type === "set_classification") return <PickerFrame><ClassificationRulePicker value={value} onChange={setValue} /></PickerFrame>;
    if (type === "set_phase_code") return <PickerFrame><PhaseCodeRulePicker value={value} isClear={action.clear} onChange={setValue} onClear={clearValue} /></PickerFrame>;
    if (type === "set_gl_account") return <PickerFrame><GlAccountRulePicker value={value} isClear={action.clear} onChange={setValue} onClear={clearValue} /></PickerFrame>;
    if (type === "set_cost_type") return <PickerFrame><CostTypeRulePicker value={value} isClear={action.clear} onChange={setValue} onClear={clearValue} /></PickerFrame>;
    if (type === "set_routing_code") return <PickerFrame><RoutingCodeRulePicker value={value} isClear={action.clear} onChange={setValue} onClear={clearValue} /></PickerFrame>;

    const placeholders: Partial<Record<RuleActionType, string>> = {
      set_vendor:      "Vendor code, e.g. ACME01",
      set_job:         "Job number, e.g. 2450",
      assign_reviewer: "Reviewer name or user ID",
      add_note:        "Note text to append to invoice…",
    };

    return (
      <div className="px-4 pb-3">
        <Input
          value={value ?? ""}
          onChange={(e) => onChange({ type, value: e.target.value })}
          placeholder={placeholders[type] ?? "Value…"}
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-3 bg-muted/40 border-b border-border">
        <div className="min-w-0 flex-1">
          <ComboboxShell
            value={type}
            displayLabel={actionLabel(type)}
            onSelect={(next) => setType(next as RuleActionType)}
            placeholder="Select action…"
            searchPlaceholder="Search actions…"
            onSearchChange={setActionSearch}
            open={actionOpen}
            onOpenChange={setActionOpen}
          >
            {filteredActionOptions.map(({ value: optionValue, label }) => {
              const item = (
                <CommandItem
                  key={optionValue}
                  value={label}
                  onSelect={() => setType(optionValue)}
                >
                  <Check className={cn("mr-2 h-4 w-4", type === optionValue ? "opacity-100" : "opacity-0")} />
                  {label}
                </CommandItem>
              );
              return optionValue === "auto_approve" ? (
                <PermissionGate key={optionValue} requires="accounting.invoices.approve">{item}</PermissionGate>
              ) : item;
            })}
          </ComboboxShell>
        </div>
        {showRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="ml-3 shrink-0 h-6 w-6 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            aria-label="Remove action"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Subtitle or value input */}
      {isValueless && subtitle ? (
        <div className="px-4 py-2.5">
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
      ) : (
        <div className="pt-3">
          {renderValueInput()}
        </div>
      )}
    </div>
  );
}

function PickerFrame({ children }: { children: ReactNode }) {
  return <div className="px-4 pb-3">{children}</div>;
}

interface PickerOption {
  value: string;
  label: string;
}

function SearchableRulePicker({
  value,
  options,
  placeholder,
  searchPlaceholder,
  isLoading,
  isClear = false,
  allowClear = false,
  onChange,
  onClear,
}: {
  value?: string;
  options: PickerOption[];
  placeholder: string;
  searchPlaceholder: string;
  isLoading?: boolean;
  isClear?: boolean;
  allowClear?: boolean;
  onChange: (value: string) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filteredOptions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options;
  }, [options, search]);
  const showClearOption = allowClear && (!search.trim() || "clear value".includes(search.trim().toLowerCase()));
  const displayLabel = isClear ? "Clear value" : options.find((option) => option.value === value)?.label ?? (value || undefined);

  return (
    <ComboboxShell
      value={value || null}
      displayLabel={displayLabel}
      onSelect={(next) => { onChange(next); setOpen(false); }}
      placeholder={placeholder}
      searchPlaceholder={searchPlaceholder}
      onSearchChange={setSearch}
      isLoading={isLoading}
      open={open}
      onOpenChange={setOpen}
    >
      {showClearOption ? (
        <CommandItem value="Clear value" onSelect={() => { onClear?.(); setOpen(false); }}>
          <X className="mr-2 h-4 w-4 shrink-0" />
          Clear value
        </CommandItem>
      ) : null}
      {filteredOptions.map((option) => (
        <CommandItem
          key={option.value}
          value={option.label}
          onSelect={() => { onChange(option.value); setOpen(false); }}
        >
          <Check className={cn("mr-2 h-4 w-4", value === option.value ? "opacity-100" : "opacity-0")} />
          <span className="truncate">{option.label}</span>
        </CommandItem>
      ))}
    </ComboboxShell>
  );
}

function ClassificationRulePicker({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const { classifications, isError, isLoading } = useClassifications();
  const options = useMemo(() => classifications
    .filter((classification) => classification.status === "active")
    .map((classification) => ({ value: classification.name, label: classification.label })), [classifications]);
  if (isError || isLoading) {
    return <p className="text-sm text-destructive">Classification options unavailable</p>;
  }
  return <SearchableRulePicker value={value} options={options} placeholder="Select document type…" searchPlaceholder="Search document types…" isLoading={isLoading} onChange={onChange} />;
}

interface ClearablePickerProps {
  value?: string;
  isClear?: boolean;
  onChange: (value: string) => void;
  onClear: () => void;
}

function PhaseCodeRulePicker({ value, isClear, onChange, onClear }: ClearablePickerProps) {
  const { data, isLoading } = usePhaseCodes();
  const options = useMemo(() => (data?.phase_codes ?? []).map((phase: PhaseCodeOption) => ({
    value: phase.phase_code,
    label: `${phase.phase_code} - ${phase.description}`,
  })), [data]);
  return <SearchableRulePicker value={value} options={options} placeholder="Select phase code…" searchPlaceholder="Search phase codes…" isLoading={isLoading} isClear={isClear} allowClear onChange={onChange} onClear={onClear} />;
}

function GlAccountRulePicker({ value, isClear, onChange, onClear }: ClearablePickerProps) {
  // The GL catalog is 2000+ rows — a server-search typeahead, not a client-filtered
  // static page. The selected account keeps its label off-page via useGlAccountByCode.
  return (
    <GlAccountDropdown
      value={isClear ? null : (value || null)}
      displayLabelOverride={isClear ? "Clear value" : undefined}
      onChange={onChange}
      onClear={onClear}
      clearOptionLabel="Clear value"
      placeholder="Select GL account…"
    />
  );
}

function CostTypeRulePicker({ value, isClear, onChange, onClear }: ClearablePickerProps) {
  const { data, isError, isLoading } = useCostTypes();
  const options = useMemo(() => (data?.costTypes ?? []).map((costType) => ({
    value: costType.value,
    label: costType.label,
  })), [data]);
  if (isError || isLoading || !data) {
    return <p className="text-sm text-destructive">Cost type options unavailable</p>;
  }
  return <SearchableRulePicker value={value} options={options} placeholder="Select cost type…" searchPlaceholder="Search cost types…" isLoading={isLoading} isClear={isClear} allowClear onChange={onChange} onClear={onClear} />;
}

function RoutingCodeRulePicker({ value, isClear, onChange, onClear }: ClearablePickerProps) {
  const { data, isLoading } = useRoutingCodes();
  const options = useMemo(() => (data?.routing_codes ?? []).map((routing: RoutingCodeOption) => ({
    value: routing.code,
    label: routing.description ? `${routing.code} - ${routing.description}` : routing.code,
  })), [data]);
  return <SearchableRulePicker value={value} options={options} placeholder="Select routing code…" searchPlaceholder="Search routing codes…" isLoading={isLoading} isClear={isClear} allowClear onChange={onChange} onClear={onClear} />;
}
