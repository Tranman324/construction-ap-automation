"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronsUpDown,
  Upload,
  X,
  ChevronRight,
  ChevronLeft,
  Building2,
  Users,
  Layers,
  Receipt,
  Sparkles,
  MapPin,
  Calendar,
  ArrowRight,
  Search,
  ShieldCheck,
  CheckCircle2,
  Circle,
  UserPlus,
  Phone,
  Mail,
  DollarSign,
  Clock,
  PartyPopper,
} from "lucide-react";
import { cn } from "@/modules/shared/lib/utils";
import { useCreateProject } from "@/modules/projects/hooks/mutations";
import { useGeocode } from "@/modules/projects/hooks/useGeocode";
import { useUsers } from "@/modules/projects/hooks/queries";
import {
  SPECTRUM_COST_CENTER_OPTIONS,
  SPECTRUM_PHASE_CODE_OPTIONS,
  QUICK_PICK_PHASE_CODES,
  type SpectrumPhaseCodeOption,
  getSpectrumCostCenterLabel,
  getSpectrumPhaseCodeId,
} from "@/modules/projects/lib/spectrumReference";
import type { User } from '@/modules/shared/types/user';
import type {
  Project,
  ProjectPhaseCode,
  ProjectBillingItem,
} from "@/modules/projects/types/project";
import { filterUser, isPmEligible, isSuperEligible } from "@/modules/projects/lib/userFilters";
import { CUSTOMER_OPTIONS, SOV_ITEMS } from "@/modules/projects/mock/referenceData";
import type { SovItem } from "@/modules/projects/mock/referenceData";
import { UserAvatar } from '@/modules/shared/components/UserAvatar';
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/modules/shared/components/ui/select";
import { Switch } from "@/modules/shared/components/ui/switch";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/modules/shared/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/modules/shared/components/ui/popover";
import {
  Dialog,
  DialogContent,
} from "@/modules/shared/components/ui/dialog";

// ─── Static Data ──────────────────────────────────────────────────────────────

/** Sequential estimate numbers for the current fiscal year. */
const ESTIMATE_OPTIONS = Array.from({ length: 99 }, (_, i) =>
  `26-${String(i + 1).padStart(4, "0")}`,
);

/** Base divisions (01-23) shown as quick-pick chips in the billing step. */
const QUICK_PICK_SOV_ITEMS = SOV_ITEMS.filter(
  (item) => /^\d{2}$/.test(item.code),
);

const STEPS = [
  { id: 0, label: "Project", icon: Building2, description: "Basic details" },
  { id: 1, label: "Team", icon: Users, description: "People & customer" },
  { id: 2, label: "Budget", icon: Layers, description: "Phase codes" },
  { id: 3, label: "Billing", icon: Receipt, description: "Schedule of values" },
  { id: 4, label: "Review", icon: ShieldCheck, description: "Verify & submit" },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function updateRow<T>(arr: T[], index: number, patch: Partial<T>): T[] {
  return arr.map((item, i) => (i === index ? { ...item, ...patch } : item));
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// ─── Step Validation ──────────────────────────────────────────────────────────

function isStep0Valid(formData: Partial<Project>, addressInput: string): boolean {
  return !!(formData.job_name?.trim() && formData.start_date && formData.end_date && addressInput.trim());
}

function isStep1Valid(pmIds: string[], superIds: string[], customer: string): boolean {
  return pmIds.length > 0 && superIds.length > 0 && !!customer;
}

// ─── New Customer Form ────────────────────────────────────────────────────────

interface NewCustomerData {
  name: string;
  contactName: string;
  secondContact: string;
  email: string;
  phone: string;
  mailingAddress: string;
}

const EMPTY_NEW_CUSTOMER: NewCustomerData = {
  name: "",
  contactName: "",
  secondContact: "",
  email: "",
  phone: "",
  mailingAddress: "",
};

// ─── TokenInput (vertical stacking) ──────────────────────────────────────────

function TokenInput({
  label,
  required,
  users,
  selectedIds,
  onChange,
  primaryLocked,
  placeholder,
}: {
  label: string;
  required?: boolean;
  users: User[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  primaryLocked?: boolean;
  placeholder?: string;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedUsers = selectedIds.map((id) => users.find((u) => u.id === id)).filter(Boolean) as User[];

  const available = useMemo(
    () =>
      users.filter(
        (u) =>
          !selectedIds.includes(u.id) &&
          (search === "" || u.name.toLowerCase().includes(search.toLowerCase())),
      ),
    [users, selectedIds, search],
  );
  const activeHighlightIdx = available.length === 0
    ? 0
    : Math.min(highlightIdx, available.length - 1);

  function addUser(user: User) {
    onChange([...selectedIds, user.id]);
    setSearch("");
    setOpen(false);
    inputRef.current?.focus();
  }

  function removeUser(id: string) {
    onChange(selectedIds.filter((sid) => sid !== id));
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Backspace" && search === "" && selectedIds.length > 0) {
      const lastId = selectedIds[selectedIds.length - 1];
      const isFirstAndLocked = primaryLocked && selectedIds.length === 1;
      if (!isFirstAndLocked) {
        removeUser(lastId);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || available.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIdx((prev) => (Math.min(prev, available.length - 1) + 1) % available.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIdx((prev) => (Math.min(prev, available.length - 1) - 1 + available.length) % available.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      addUser(available[activeHighlightIdx]);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </label>
      <div className="relative">
        <div
          className={cn(
            "rounded-md border border-input bg-transparent px-2.5 py-2 flex flex-col gap-1.5 cursor-text transition-colors",
            "focus-within:ring-2 focus-within:ring-ring focus-within:border-transparent",
          )}
          onClick={() => inputRef.current?.focus()}
        >
          {/* Selected tokens — one per row, stacked vertically */}
          {selectedUsers.map((user, idx) => {
            const isPrimary = primaryLocked && idx === 0;
            return (
              <div
                key={user.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm transition-colors",
                  isPrimary
                    ? "bg-primary/10 border-primary/30"
                    : "bg-muted border-border hover:bg-muted/80",
                )}
              >
                <UserAvatar user={{ name: user.name, image: user.avatar_url }} size="sm" />
                <span className="flex-1 truncate font-medium">{user.name}</span>
                {user.job_title && (
                  <span className="text-[11px] text-muted-foreground truncate max-w-[140px] hidden sm:inline">
                    {user.job_title}
                  </span>
                )}
                {isPrimary ? (
                  <span className="text-[10px] text-primary font-semibold uppercase tracking-wider shrink-0">
                    Primary
                  </span>
                ) : (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeUser(user.id);
                    }}
                    className="rounded-sm hover:bg-foreground/10 p-0.5 cursor-pointer shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
          {/* Search input at bottom */}
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setHighlightIdx(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              setTimeout(() => setOpen(false), 200);
            }}
            onKeyDown={handleKeyDown}
            placeholder={selectedIds.length === 0 ? (placeholder ?? "Type a name...") : "Add another..."}
            className="bg-transparent outline-none text-sm placeholder:text-muted-foreground py-1"
          />
        </div>

        {open && available.length > 0 && (
          <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
            {available.map((user, idx) => (
              <button
                key={user.id}
                type="button"
                ref={idx === highlightIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  addUser(user);
                }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer",
                  idx === activeHighlightIdx ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                )}
              >
                <UserAvatar user={{ name: user.name, image: user.avatar_url }} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{user.name}</span>
                  {user.job_title && (
                    <span className="text-[11px] text-muted-foreground truncate">{user.job_title}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
        {open && search !== "" && available.length === 0 && (
          <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg p-3">
            <p className="text-sm text-muted-foreground">No matching people</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Wizard Component ─────────────────────────────────────────────────────────

interface JobSetupWizardProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function JobSetupWizard({ open, onOpenChange }: JobSetupWizardProps) {
  const router = useRouter();
  const createProject = useCreateProject();
  const { data: usersData } = useUsers();
  const users: User[] = usersData ?? [];
  const PM_USERS = users.filter(isPmEligible);
  const SUPER_USERS = users.filter(isSuperEligible);
  const ACTIVE_USERS = users.filter(filterUser);

  const isModal = open !== undefined;
  const redirectTimerRef = useRef<number | null>(null);

  // ── Step state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<"forward" | "backward">("forward");
  const [highestVisited, setHighestVisited] = useState(0);

  // ── Form state ────────────────────────────────────────────────────────────
  const [formData, setFormData] = useState<Partial<Project>>({});
  const [pmIds, setPmIds] = useState<string[]>([]);
  const [superIds, setSuperIds] = useState<string[]>([]);
  const [estimatorIds, setEstimatorIds] = useState<string[]>([]);
  const [whoSoldId, setWhoSoldId] = useState("");
  const [customer, setCustomer] = useState("");
  const [addressInput, setAddressInput] = useState("");
  const [queryAddress, setQueryAddress] = useState("");
  const [whoSoldOpen, setWhoSoldOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [viewpointSetup, setViewpointSetup] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");

  // Refs for tab-advance after Popover combobox selection
  const whoSoldTriggerRef = useRef<HTMLButtonElement>(null);
  const viewpointSwitchRef = useRef<HTMLButtonElement>(null);

  // ── New customer form ─────────────────────────────────────────────────────
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomerData, setNewCustomerData] = useState<NewCustomerData>(EMPTY_NEW_CUSTOMER);

  function handleSaveNewCustomer() {
    if (!newCustomerData.name.trim()) return;
    setCustomer(newCustomerData.name.trim());
    setShowNewCustomer(false);
  }

  function handleCancelNewCustomer() {
    setShowNewCustomer(false);
    setNewCustomerData(EMPTY_NEW_CUSTOMER);
  }

  // ── Phase codes + SOV state ───────────────────────────────────────────────
  const [phaseCodes, setPhaseCodes] = useState<ProjectPhaseCode[]>([
    { phase_code: '01000', description: 'General Conditions', cost_type: 'O', amount: 0 },
    { phase_code: '01101', description: 'Superintendent', cost_type: 'L', amount: 0 },
    { phase_code: '01102', description: 'Project Manager', cost_type: 'L', amount: 0 },
    { phase_code: '01502', description: 'Dumpsters', cost_type: 'E', amount: 0 },
  ]);
  const [billingItems, setBillingItems] = useState<ProjectBillingItem[]>([]);

  // ── Phase code autocomplete ───────────────────────────────────────────────
  const [phaseSearch, setPhaseSearch] = useState("");
  const [phaseDropdownOpen, setPhaseDropdownOpen] = useState(false);
  const [phaseHighlightIdx, setPhaseHighlightIdx] = useState(0);
  const phaseInputRef = useRef<HTMLInputElement>(null);

  // ── SOV billing autocomplete ──────────────────────────────────────────────
  const [sovSearch, setSovSearch] = useState("");
  const [sovDropdownOpen, setSovDropdownOpen] = useState(false);
  const [sovHighlightIdx, setSovHighlightIdx] = useState(0);
  const sovInputRef = useRef<HTMLInputElement>(null);

  const addedSovCodes = useMemo(
    () => new Set(billingItems.map((bi) => bi.code).filter(Boolean) as string[]),
    [billingItems],
  );

  const sovMatches = useMemo(
    () =>
      sovSearch.trim() === ""
        ? []
        : SOV_ITEMS.filter(
            (item) =>
              !addedSovCodes.has(item.code) &&
              (item.description.toLowerCase().includes(sovSearch.toLowerCase()) ||
                item.code.toLowerCase().includes(sovSearch.toLowerCase())),
          ),
    [sovSearch, addedSovCodes],
  );
  const activeSovHighlightIdx = sovMatches.length === 0
    ? 0
    : Math.min(sovHighlightIdx, sovMatches.length - 1);

  function addSovItem(item: SovItem) {
    setBillingItems((prev) => [
      ...prev,
      { item_number: prev.length + 1, code: item.code, description: item.description, amount: 0 },
    ]);
    setSovSearch("");
    setSovDropdownOpen(false);
    setTimeout(() => sovInputRef.current?.focus(), 50);
  }

  function removeBillingItem(idx: number) {
    setBillingItems((prev) => prev.filter((_, i) => i !== idx).map((item, i) => ({ ...item, item_number: i + 1 })));
  }

  function toggleSovChip(item: SovItem) {
    if (addedSovCodes.has(item.code)) {
      const idx = billingItems.findIndex((bi) => bi.code === item.code);
      if (idx >= 0) removeBillingItem(idx);
    } else {
      addSovItem(item);
    }
  }

  function handleSovKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setSovDropdownOpen(false);
      return;
    }
    if (!sovDropdownOpen || sovMatches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSovHighlightIdx((prev) => (Math.min(prev, sovMatches.length - 1) + 1) % sovMatches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSovHighlightIdx((prev) => (Math.min(prev, sovMatches.length - 1) - 1 + sovMatches.length) % sovMatches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      addSovItem(sovMatches[activeSovHighlightIdx]);
    }
  }

  // ── Review acknowledgment ─────────────────────────────────────────────────
  const [ackedPhaseCodes, setAckedPhaseCodes] = useState<Set<string>>(new Set());
  const [ackedBillingItems, setAckedBillingItems] = useState<Set<string>>(new Set());

  const addedPhaseCodes = useMemo(
    () => new Set(phaseCodes.map((pc) => getSpectrumPhaseCodeId(pc))),
    [phaseCodes],
  );
  const phaseMatches = useMemo(
    () =>
      phaseSearch.trim() === ""
        ? []
        : SPECTRUM_PHASE_CODE_OPTIONS.filter(
            (entry) =>
              !addedPhaseCodes.has(getSpectrumPhaseCodeId(entry)) &&
              (entry.description.toLowerCase().includes(phaseSearch.toLowerCase()) ||
                entry.phase_code.includes(phaseSearch)),
          ),
    [phaseSearch, addedPhaseCodes],
  );
  const activePhaseHighlightIdx = phaseMatches.length === 0
    ? 0
    : Math.min(phaseHighlightIdx, phaseMatches.length - 1);

  function addPhaseCode(entry: SpectrumPhaseCodeOption) {
    setPhaseCodes((prev) => [...prev, { ...entry, amount: 0 }]);
    setPhaseSearch("");
    setPhaseDropdownOpen(false);
    setTimeout(() => phaseInputRef.current?.focus(), 50);
  }

  function removePhaseCode(idx: number) {
    const removed = phaseCodes[idx];
    const removedId = getSpectrumPhaseCodeId(removed);
    setPhaseCodes((prev) => prev.filter((_, i) => i !== idx));
    setAckedPhaseCodes((prev) => {
      const next = new Set(prev);
      next.delete(removedId);
      return next;
    });
  }

  function toggleChipPhaseCode(entry: SpectrumPhaseCodeOption) {
    const id = getSpectrumPhaseCodeId(entry);
    if (addedPhaseCodes.has(id)) {
      const idx = phaseCodes.findIndex((pc) => getSpectrumPhaseCodeId(pc) === id);
      if (idx >= 0) removePhaseCode(idx);
    } else {
      addPhaseCode(entry);
    }
  }

  function handlePhaseKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setPhaseDropdownOpen(false);
      return;
    }
    if (!phaseDropdownOpen || phaseMatches.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setPhaseHighlightIdx((prev) => (Math.min(prev, phaseMatches.length - 1) + 1) % phaseMatches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setPhaseHighlightIdx((prev) => (Math.min(prev, phaseMatches.length - 1) - 1 + phaseMatches.length) % phaseMatches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      addPhaseCode(phaseMatches[activePhaseHighlightIdx]);
    }
  }

  function toggleAck(id: string) {
    setAckedPhaseCodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBillingAck(key: string) {
    setAckedBillingItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const ackedCount = phaseCodes.filter((pc) => ackedPhaseCodes.has(getSpectrumPhaseCodeId(pc))).length;
  const allPhaseCodesAcked = phaseCodes.length === 0 || ackedCount === phaseCodes.length;

  const activeBillingItems = billingItems.filter((i) => i.description.trim() !== "");
  const billingAckedCount = activeBillingItems.filter((_, idx) => ackedBillingItems.has(String(idx))).length;
  const allBillingAcked = activeBillingItems.length === 0 || billingAckedCount === activeBillingItems.length;

  // ── Geocoding ─────────────────────────────────────────────────────────────
  const { data: geoData } = useGeocode(queryAddress);

  // ── Navigation after success ──────────────────────────────────────────────
  const [showSuccess, setShowSuccess] = useState(false);
  useEffect(() => {
    return () => {
      if (redirectTimerRef.current !== null) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  const effectiveFormData = geoData
    ? { ...formData, lat: geoData.lat, lng: geoData.lng }
    : formData;

  // ── Derived ───────────────────────────────────────────────────────────────
  const primaryPm = pmIds[0] ? PM_USERS.find((u) => u.id === pmIds[0]) : undefined;
  const primarySuper = superIds[0] ? SUPER_USERS.find((u) => u.id === superIds[0]) : undefined;
  const whoSoldUser = whoSoldId ? ACTIVE_USERS.find((u) => u.id === whoSoldId) : undefined;

  const stepValid = useMemo(
    () => [
      isStep0Valid(formData, addressInput),
      isStep1Valid(pmIds, superIds, customer),
      true,
      true,
      allPhaseCodesAcked && allBillingAcked,
    ],
    [formData, addressInput, pmIds, superIds, customer, allPhaseCodesAcked, allBillingAcked],
  );

  const allValid = stepValid[0] && stepValid[1] && stepValid[4];

  // ── Navigation ────────────────────────────────────────────────────────────
  const goTo = useCallback(
    (target: number) => {
      if (target < 0 || target > 4) return;
      setDirection(target > step ? "forward" : "backward");
      setStep(target);
      setHighestVisited((prev) => Math.max(prev, target));
    },
    [step],
  );

  const next = useCallback(() => goTo(step + 1), [goTo, step]);
  const prev = useCallback(() => goTo(step - 1), [goTo, step]);

  // ── Submit ────────────────────────────────────────────────────────────────
  function handleSubmit() {
    const activeBilling = billingItems.filter((item) => item.description.trim() !== "");
    const contractValue = activeBilling.reduce((s, i) => s + i.amount, 0);
    createProject.mutate({
      ...effectiveFormData,
      job_name: effectiveFormData.job_name ?? "",
      customer_name: customer,
      address: addressInput,
      who_sold: whoSoldUser?.name ?? "",
      contract_value: contractValue,
      phase_codes: phaseCodes,
      billing_items: activeBilling,
      pmIds,
      superIds,
    }, {
      onSuccess: () => {
        setShowSuccess(true);
        redirectTimerRef.current = window.setTimeout(() => {
          if (isModal && onOpenChange) {
            onOpenChange(false);
          }
          router.push("/projects");
        }, 2400);
      },
    });
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const phaseTotal = phaseCodes.reduce((s, pc) => s + pc.amount, 0);
  const billingTotal = billingItems.reduce((s, i) => s + i.amount, 0);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER — Wizard Content
  // ─────────────────────────────────────────────────────────────────────────

  const wizardContent = showSuccess ? (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="flex flex-col items-center gap-5 animate-in fade-in zoom-in-75 duration-500">
        <div className="relative">
          <div className="h-20 w-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center animate-in zoom-in-0 duration-500">
            <CheckCircle2 className="h-10 w-10 text-emerald-500 animate-in spin-in-180 duration-700" />
          </div>
          <PartyPopper className="absolute -top-2 -right-2 h-7 w-7 text-amber-500 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300" style={{ animationFillMode: 'both' }} />
          <Sparkles className="absolute -bottom-1 -left-3 h-5 w-5 text-primary animate-in fade-in slide-in-from-top-2 duration-500 delay-500" style={{ animationFillMode: 'both' }} />
        </div>
        <div className="text-center space-y-1.5 animate-in fade-in slide-in-from-bottom-3 duration-500 delay-200" style={{ animationFillMode: 'both' }}>
          <h2 className="text-xl font-bold text-foreground">Project Submitted!</h2>
          <p className="text-sm text-muted-foreground max-w-xs">
            {formData.job_name || 'Your project'} has been submitted for approval. Redirecting to dashboard&hellip;
          </p>
        </div>
        <div className="h-1 w-48 rounded-full bg-muted overflow-hidden animate-in fade-in duration-500 delay-500" style={{ animationFillMode: 'both' }}>
          <div className="h-full bg-emerald-500 rounded-full animate-[progress-fill_1.8s_ease-out_0.6s_both]" />
        </div>
      </div>
    </div>
  ) : (
    <div
      className={cn(
        "flex flex-col lg:flex-row",
        isModal
          ? "h-full min-h-0 overflow-hidden gap-0"
          : "min-h-[calc(100vh-4rem)] gap-0 lg:gap-8 max-w-6xl mx-auto px-4 py-6 lg:py-10",
      )}
    >
      {/* ── Desktop Sidebar Stepper ──────────────────────────────────────── */}
      <nav
        className={cn(
          "hidden lg:flex flex-col w-56 shrink-0",
          isModal ? "border-r border-border/60 px-4 py-5" : "pt-2",
        )}
      >
        <h1 className="text-lg font-semibold mb-1">New Project</h1>
        <p className="text-xs text-muted-foreground mb-6">Complete each section to submit</p>

        <ol className="relative space-y-1">
          {STEPS.map((s, i) => {
            const isActive = step === i;
            const isDone = stepValid[i] && highestVisited > i;
            const isClickable = i <= highestVisited + 1 && (i === 0 || stepValid[i - 1] || i <= highestVisited);
            const Icon = s.icon;

            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => isClickable && goTo(i)}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-[background-color,box-shadow] duration-200 group cursor-pointer",
                    isActive && "bg-primary/10 shadow-sm",
                    !isActive && isClickable && "hover:bg-muted/60",
                    !isClickable && "opacity-40 cursor-not-allowed",
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center justify-center h-8 w-8 rounded-full shrink-0 text-xs font-medium transition-[background-color,color,box-shadow] duration-200",
                      isActive && "bg-primary text-primary-foreground shadow-md shadow-primary/25",
                      isDone && !isActive && "bg-primary/15 text-primary",
                      !isActive && !isDone && "bg-muted text-muted-foreground",
                    )}
                  >
                    {isDone && !isActive ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
                  </span>
                  <div className="flex flex-col min-w-0">
                    <span
                      className={cn(
                        "text-sm font-medium truncate",
                        isActive && "text-foreground",
                        !isActive && "text-muted-foreground group-hover:text-foreground",
                      )}
                    >
                      {s.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate">{s.description}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>

        {/* Step progress bar */}
        <div className="mt-auto pt-8">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
            <span>Progress</span>
            <span>{Math.round(((step + (step === 4 ? 1 : 0)) / 5) * 100)}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${((step + (step === 4 ? 1 : 0)) / 5) * 100}%` }}
            />
          </div>
        </div>
      </nav>

      {/* ── Mobile Progress Bar ──────────────────────────────────────────── */}
      <div className={cn("lg:hidden", isModal ? "px-4 pt-4 pb-2" : "mb-4")}>
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-base font-semibold">New Project</h1>
          <span className="text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length}
          </span>
        </div>
        <div className="flex gap-1.5">
          {STEPS.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => i <= highestVisited && goTo(i)}
              disabled={i > highestVisited}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-[background-color] duration-300 cursor-pointer",
                i <= step ? "bg-primary" : "bg-muted",
                i > highestVisited && "cursor-not-allowed",
              )}
            />
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
          {(() => { const Icon = STEPS[step].icon; return <Icon className="h-3.5 w-3.5" />; })()}
          {STEPS[step].label} &mdash; {STEPS[step].description}
        </p>
      </div>

      {/* ── Main Content Area ────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex-1 min-w-0 min-h-0 flex flex-col",
          isModal ? "overflow-hidden px-6 py-5" : "",
        )}
      >
        <div
          key={step}
          className={cn(
            "animate-in fade-in duration-300 flex-1 min-h-0 flex flex-col",
            direction === "forward" ? "slide-in-from-right-4" : "slide-in-from-left-4",
          )}
          style={{ animationDuration: "300ms" }}
        >
          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* STEP 0 — Project Details                                      */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {step === 0 && (
            <StepCard
              title="Project Details"
              subtitle="Tell us about the job"
              icon={<Building2 className="h-5 w-5" />}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                {/* Job Name */}
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label className="text-sm font-medium">
                    Job Name<span className="text-destructive ml-0.5">*</span>
                  </label>
                  <Input
                    autoFocus
                    required
                    value={formData.job_name ?? ""}
                    onChange={(e) => setFormData((prev) => ({ ...prev, job_name: e.target.value }))}
                    placeholder="e.g. Lakeside HQ Renovation"
                    className="h-11"
                  />
                </div>

                {/* Cost Center */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Cost Center</label>
                  <Select
                    value={formData.cost_center ?? ""}
                    onValueChange={(val) => setFormData((prev) => ({ ...prev, cost_center: val }))}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select cost center" />
                    </SelectTrigger>
                    <SelectContent>
                      {SPECTRUM_COST_CENTER_OPTIONS.map((option) => (
                        <SelectItem key={option.code} value={option.code}>
                          {option.code} - {option.description}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Estimate Number */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">Estimate Number</label>
                  <Select
                    value={formData.estimate_number ?? ""}
                    onValueChange={(val) => setFormData((prev) => ({ ...prev, estimate_number: val }))}
                  >
                    <SelectTrigger className="h-11">
                      <SelectValue placeholder="Select estimate #" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      {ESTIMATE_OPTIONS.map((opt) => (
                        <SelectItem key={opt} value={opt}>
                          {opt}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Start Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">
                    Start Date<span className="text-destructive ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="date"
                      required
                      value={formData.start_date ?? ""}
                      onChange={(e) => setFormData((prev) => ({ ...prev, start_date: e.target.value }))}
                      className="h-11 pl-10"
                    />
                  </div>
                </div>

                {/* End Date */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-sm font-medium">
                    End Date<span className="text-destructive ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      type="date"
                      required
                      value={formData.end_date ?? ""}
                      onChange={(e) => setFormData((prev) => ({ ...prev, end_date: e.target.value }))}
                      className="h-11 pl-10"
                    />
                  </div>
                </div>

                {/* Building Address */}
                <div className="flex flex-col gap-1.5 md:col-span-2">
                  <label className="text-sm font-medium">
                    Building Address<span className="text-destructive ml-0.5">*</span>
                  </label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      required
                      value={addressInput}
                      onChange={(e) => setAddressInput(e.target.value)}
                      onBlur={() => setQueryAddress(addressInput)}
                      placeholder="e.g. 600 Example Ave NE, Atlanta, GA"
                      className="h-11 pl-10"
                    />
                  </div>
                  {geoData !== undefined && geoData !== null && (
                    <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      Coordinates found
                    </p>
                  )}
                  {queryAddress !== "" && geoData === null && (
                    <p className="text-xs text-muted-foreground">Address not recognized</p>
                  )}
                </div>

                {/* Toggle Row */}
                <div className="flex flex-wrap items-center gap-x-8 gap-y-4 md:col-span-2 pt-1">
                  {/* Service Job */}
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={formData.job_type === "Service"}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({ ...prev, job_type: checked ? "Service" : "" }))
                      }
                    />
                    <label className="text-sm font-medium">Service Job</label>
                  </div>

                  {/* Photos Required */}
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={formData.photos_required ?? false}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({ ...prev, photos_required: checked }))
                      }
                    />
                    <label className="text-sm font-medium">Photos Required</label>
                  </div>

                  {/* Closeout Type */}
                  <div className="flex items-center gap-3">
                    <Switch
                      checked={(formData.closeout_type ?? "short") === "full"}
                      onCheckedChange={(checked) =>
                        setFormData((prev) => ({ ...prev, closeout_type: checked ? "full" : "short" }))
                      }
                    />
                    <label className="text-sm font-medium">
                      {(formData.closeout_type ?? "short") === "full" ? "Long" : "Short"} Closeout
                    </label>
                  </div>
                </div>
              </div>
            </StepCard>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* STEP 1 — Team & Customer                                      */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {step === 1 && (
            <StepCard
              title="Team & Customer"
              subtitle="Assign the right people"
              icon={<Users className="h-5 w-5" />}
            >
              <div className="grid grid-cols-1 gap-y-5">
                {/* Project Manager */}
                <TokenInput
                  label="Project Manager"
                  required
                  users={PM_USERS}
                  selectedIds={pmIds}
                  onChange={setPmIds}
                  primaryLocked
                  placeholder="Type a PM name..."
                />

                {/* Superintendent */}
                <TokenInput
                  label="Superintendent"
                  required
                  users={SUPER_USERS}
                  selectedIds={superIds}
                  onChange={setSuperIds}
                  primaryLocked
                  placeholder="Type a superintendent name..."
                />

                {/* Estimator */}
                <TokenInput
                  label="Estimator"
                  users={ACTIVE_USERS}
                  selectedIds={estimatorIds}
                  onChange={setEstimatorIds}
                  placeholder="Type an estimator name..."
                />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                  {/* Customer */}
                  <div className={cn("flex flex-col gap-1.5", showNewCustomer && "md:col-span-2")}>
                    <label className="text-sm font-medium">
                      Customer<span className="text-destructive ml-0.5">*</span>
                    </label>
                    {!showNewCustomer ? (
                      <>
                        <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={customerOpen}
                              className="w-full justify-between font-normal h-11"
                            >
                              {customer || "Select or type customer"}
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0" align="start">
                            <Command>
                              <CommandInput
                                placeholder="Search or type customer..."
                                value={customerSearch}
                                onValueChange={setCustomerSearch}
                              />
                              <CommandList>
                                <CommandEmpty>No match found.</CommandEmpty>
                                <CommandGroup>
                                  {CUSTOMER_OPTIONS.filter((opt) =>
                                    opt.toLowerCase().includes(customerSearch.toLowerCase()),
                                  ).map((opt) => (
                                    <CommandItem
                                      key={opt}
                                      value={opt}
                                      onSelect={() => { setCustomer(opt); setCustomerSearch(""); setCustomerOpen(false); setTimeout(() => whoSoldTriggerRef.current?.focus(), 0); }}
                                    >
                                      <span>{opt}</span>
                                      <Check className={cn("ml-auto h-4 w-4", customer === opt ? "opacity-100" : "opacity-0")} />
                                    </CommandItem>
                                  ))}
                                  {customerSearch !== "" &&
                                    !CUSTOMER_OPTIONS.some((opt) => opt.toLowerCase() === customerSearch.toLowerCase()) && (
                                      <CommandItem
                                        value={`__create__${customerSearch}`}
                                        onSelect={() => { setCustomer(customerSearch); setCustomerSearch(""); setCustomerOpen(false); setTimeout(() => whoSoldTriggerRef.current?.focus(), 0); }}
                                      >
                                        Create &quot;{customerSearch}&quot;
                                      </CommandItem>
                                    )}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="w-fit text-xs gap-1.5 -mt-0.5"
                          onClick={() => setShowNewCustomer(true)}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          New Customer
                        </Button>
                      </>
                    ) : (
                      /* ── New Customer Inline Form ─────────────────────── */
                      <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <UserPlus className="h-4 w-4 text-primary" />
                            New Customer
                          </p>
                          <button
                            type="button"
                            onClick={handleCancelNewCustomer}
                            className="rounded-sm hover:bg-foreground/10 p-1 cursor-pointer"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Customer Name *</label>
                            <Input
                              autoFocus
                              value={newCustomerData.name}
                              onChange={(e) => setNewCustomerData((p) => ({ ...p, name: e.target.value }))}
                              placeholder="Company name"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Contact Name *</label>
                            <Input
                              value={newCustomerData.contactName}
                              onChange={(e) => setNewCustomerData((p) => ({ ...p, contactName: e.target.value }))}
                              placeholder="Primary contact"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground">Second Contact Name</label>
                            <Input
                              value={newCustomerData.secondContact}
                              onChange={(e) => setNewCustomerData((p) => ({ ...p, secondContact: e.target.value }))}
                              placeholder="Optional"
                              className="h-9 text-sm"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-muted-foreground flex items-center gap-1">
                                <Mail className="h-3 w-3" /> Email *
                              </label>
                              <Input
                                type="email"
                                value={newCustomerData.email}
                                onChange={(e) => setNewCustomerData((p) => ({ ...p, email: e.target.value }))}
                                placeholder="email@company.example"
                                className="h-9 text-sm"
                              />
                            </div>
                            <div className="flex flex-col gap-1">
                              <label className="text-xs text-muted-foreground flex items-center gap-1">
                                <Phone className="h-3 w-3" /> Phone *
                              </label>
                              <Input
                                type="tel"
                                value={newCustomerData.phone}
                                onChange={(e) => setNewCustomerData((p) => ({ ...p, phone: e.target.value }))}
                                placeholder="(555) 555-5555"
                                className="h-9 text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1">
                            <label className="text-xs text-muted-foreground flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> Mailing Address *
                            </label>
                            <Input
                              value={newCustomerData.mailingAddress}
                              onChange={(e) => setNewCustomerData((p) => ({ ...p, mailingAddress: e.target.value }))}
                              placeholder="123 Main St, Atlanta, GA 30309"
                              className="h-9 text-sm"
                            />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-1">
                          <Button type="button" variant="ghost" size="sm" onClick={handleCancelNewCustomer}>
                            Cancel
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={!newCustomerData.name.trim() || !newCustomerData.contactName.trim() || !newCustomerData.email.trim() || !newCustomerData.phone.trim() || !newCustomerData.mailingAddress.trim()}
                            onClick={handleSaveNewCustomer}
                          >
                            Save Customer
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Who Sold */}
                  <div className="flex flex-col gap-1.5">
                    <label className="text-sm font-medium">Who Sold</label>
                    <Popover open={whoSoldOpen} onOpenChange={setWhoSoldOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          ref={whoSoldTriggerRef}
                          variant="outline"
                          role="combobox"
                          aria-expanded={whoSoldOpen}
                          className="w-full justify-between font-normal h-11"
                        >
                          {whoSoldUser ? whoSoldUser.name : "Select who sold"}
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-full p-0" align="start">
                        <Command>
                          <CommandInput placeholder="Search..." />
                          <CommandList>
                            <CommandEmpty>No match found.</CommandEmpty>
                            <CommandGroup>
                              {ACTIVE_USERS.map((u) => (
                                <CommandItem
                                  key={u.id}
                                  value={u.name}
                                  onSelect={() => {
                                    setWhoSoldId(u.id);
                                    setFormData((prev) => ({ ...prev, who_sold: u.name }));
                                    setWhoSoldOpen(false);
                                    setTimeout(() => viewpointSwitchRef.current?.focus(), 0);
                                  }}
                                >
                                  <span>{u.name}</span>
                                  <Check className={cn("ml-auto h-4 w-4", whoSoldId === u.id ? "opacity-100" : "opacity-0")} />
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                {/* Viewpoint Toggle */}
                <div className="flex items-center gap-3 pt-1">
                  <Switch ref={viewpointSwitchRef} id="viewpoint-setup" checked={viewpointSetup} onCheckedChange={setViewpointSetup} />
                  <label htmlFor="viewpoint-setup" className="text-sm font-medium cursor-pointer">
                    Viewpoint Team Setup
                  </label>
                </div>
              </div>
            </StepCard>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* STEP 2 — Phase Codes (chip selector + search)                 */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {step === 2 && (
            <StepCard
              title="Phase Codes"
              subtitle="Select common codes or search for specific ones"
              icon={<Layers className="h-5 w-5" />}
            >
              {/* ── Chip selector ──────────────────────────────────────── */}
              <div className="mb-5">
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">
                  Popular Phase Codes
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PICK_PHASE_CODES.map((entry) => {
                    const id = getSpectrumPhaseCodeId(entry);
                    const isSelected = addedPhaseCodes.has(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleChipPhaseCode(entry)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium",
                          "border transition-[background-color,color,border-color,box-shadow,scale] duration-200 cursor-pointer select-none",
                          "hover:shadow-sm active:scale-[0.97]",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-muted/50 text-foreground border-border hover:bg-muted hover:border-foreground/20",
                        )}
                      >
                        <span
                          className={cn(
                            "flex items-center justify-center h-4 w-4 rounded-full transition-[background-color] duration-200 shrink-0",
                            isSelected
                              ? "bg-primary-foreground/20"
                              : "bg-transparent",
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </span>
                        <span>{entry.description}</span>
                        <span
                          className={cn(
                            "text-[10px] font-mono opacity-60",
                            isSelected ? "text-primary-foreground" : "text-muted-foreground",
                          )}
                        >
                          {entry.phase_code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Search autocomplete ────────────────────────────────── */}
              <div className="relative mb-5">
                <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-medium">
                  Search All Phase Codes
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    ref={phaseInputRef}
                    value={phaseSearch}
                    onChange={(e) => {
                      setPhaseSearch(e.target.value);
                      setPhaseHighlightIdx(0);
                      setPhaseDropdownOpen(true);
                    }}
                    onFocus={() => phaseSearch.trim() !== "" && setPhaseDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setPhaseDropdownOpen(false), 200)}
                    onKeyDown={handlePhaseKeyDown}
                    placeholder="Type a description or code... (e.g. Electrical, HVAC, 15800)"
                    className={cn(
                      "w-full h-11 rounded-md border border-input bg-transparent pl-10 pr-4 text-sm placeholder:text-muted-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
                      "transition-colors",
                    )}
                  />
                </div>
                {phaseDropdownOpen && phaseMatches.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
                    {phaseMatches.map((entry, idx) => (
                      <button
                        key={getSpectrumPhaseCodeId(entry)}
                        type="button"
                        ref={idx === phaseHighlightIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addPhaseCode(entry);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 text-sm text-left transition-colors cursor-pointer",
                          idx === activePhaseHighlightIdx ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                        )}
                      >
                        <span>{entry.description}</span>
                        <span className="flex items-center gap-2 shrink-0 ml-3">
                          <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{entry.phase_code}</span>
                          <span className="text-xs text-muted-foreground">{entry.cost_type}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {phaseDropdownOpen && phaseSearch.trim() !== "" && phaseMatches.length === 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg p-3">
                    <p className="text-sm text-muted-foreground">No matching phase codes</p>
                  </div>
                )}
              </div>

              {/* ── Added phase codes table ────────────────────────────── */}
              {phaseCodes.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 py-10 text-center">
                  <Layers className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No phase codes added yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Click a chip above or search to add phase codes</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Selected Phase Codes ({phaseCodes.length})
                    </p>
                  </div>
                  <div className="overflow-auto max-h-[20rem] -mx-1">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="border-b border-border text-left">
                          <th className="pb-2.5 pr-3 font-medium text-muted-foreground text-xs uppercase tracking-wider w-24">Code</th>
                          <th className="pb-2.5 pr-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Description</th>
                          <th className="pb-2.5 pr-3 font-medium text-muted-foreground text-xs uppercase tracking-wider w-16">Type</th>
                          <th className="pb-2.5 pr-3 font-medium text-muted-foreground text-xs uppercase tracking-wider text-right w-36">Amount</th>
                          <th className="pb-2.5 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {phaseCodes.map((pc, idx) => (
                          <tr key={`${getSpectrumPhaseCodeId(pc)}-${idx}`} className="border-b border-border/40 last:border-0 group">
                            <td className="py-2.5 pr-3">
                              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{pc.phase_code}</span>
                            </td>
                            <td className="py-2.5 pr-3 text-sm">{pc.description}</td>
                            <td className="py-2.5 pr-3">
                              <Select
                                value={pc.cost_type}
                                onValueChange={(val) =>
                                  setPhaseCodes((prev) => updateRow(prev, idx, { cost_type: val as ProjectPhaseCode["cost_type"] }))
                                }
                              >
                                <SelectTrigger className="h-7 text-xs w-16">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {(["S", "M", "L", "O", "E", "B", "X"] as const).map((ct) => (
                                    <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="py-2.5 pr-3">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={pc.amount || ""}
                                onChange={(e) =>
                                  setPhaseCodes((prev) => updateRow(prev, idx, { amount: parseFloat(e.target.value) || 0 }))
                                }
                                className="h-7 text-xs text-right w-full"
                                placeholder="$0.00"
                              />
                            </td>
                            <td className="py-2.5 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                tabIndex={-1}
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                onClick={() => removePhaseCode(idx)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-card z-10">
                        <tr>
                          <td colSpan={3} className="pt-3 text-sm font-medium text-right pr-3">Total</td>
                          <td className="pt-3 text-sm font-semibold text-right pr-3 tabular-nums">{fmt.format(phaseTotal)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

              <div className="mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => console.log("[STUB] Budget upload")}
                >
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload Budget (.xlsm)
                </Button>
              </div>
            </StepCard>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* STEP 3 — Schedule of Values (chip selector + search)          */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {step === 3 && (
            <StepCard
              title="Schedule of Values"
              subtitle="Select billing divisions or search for alternates"
              icon={<Receipt className="h-5 w-5" />}
            >
              {/* ── Chip selector (base divisions 01-23) ───────────────── */}
              <div className="mb-5">
                <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-medium">
                  Cost Divisions
                </p>
                <div className="flex flex-wrap gap-2">
                  {QUICK_PICK_SOV_ITEMS.map((item) => {
                    const isSelected = addedSovCodes.has(item.code);
                    return (
                      <button
                        key={item.code}
                        type="button"
                        onClick={() => toggleSovChip(item)}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium",
                          "border transition-[background-color,color,border-color,box-shadow,scale] duration-200 cursor-pointer select-none",
                          "hover:shadow-sm active:scale-[0.97]",
                          isSelected
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "bg-muted/50 text-foreground border-border hover:bg-muted hover:border-foreground/20",
                        )}
                      >
                        <span
                          className={cn(
                            "flex items-center justify-center h-4 w-4 rounded-full transition-[background-color] duration-200 shrink-0",
                            isSelected ? "bg-primary-foreground/20" : "bg-transparent",
                          )}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </span>
                        <span>{item.description}</span>
                        <span
                          className={cn(
                            "text-[10px] font-mono opacity-60",
                            isSelected ? "text-primary-foreground" : "text-muted-foreground",
                          )}
                        >
                          {item.code}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* ── Search autocomplete (all SOV items incl. alternates) ── */}
              <div className="relative mb-5">
                <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wider font-medium">
                  Search All Items &amp; Alternates
                </p>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <input
                    ref={sovInputRef}
                    value={sovSearch}
                    onChange={(e) => {
                      setSovSearch(e.target.value);
                      setSovHighlightIdx(0);
                      setSovDropdownOpen(true);
                    }}
                    onFocus={() => sovSearch.trim() !== "" && setSovDropdownOpen(true)}
                    onBlur={() => setTimeout(() => setSovDropdownOpen(false), 200)}
                    onKeyDown={handleSovKeyDown}
                    placeholder="Type a description or code... (e.g. HVAC, AA1, Voluntary)"
                    className={cn(
                      "w-full h-11 rounded-md border border-input bg-transparent pl-10 pr-4 text-sm placeholder:text-muted-foreground",
                      "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
                      "transition-colors",
                    )}
                  />
                </div>
                {sovDropdownOpen && sovMatches.length > 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg max-h-64 overflow-y-auto">
                    {sovMatches.map((item, idx) => (
                      <button
                        key={item.code}
                        type="button"
                        ref={idx === sovHighlightIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addSovItem(item);
                        }}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-2.5 text-sm text-left transition-colors cursor-pointer",
                          idx === activeSovHighlightIdx ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                        )}
                      >
                        <span>{item.description}</span>
                        <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0 ml-3">{item.code}</span>
                      </button>
                    ))}
                  </div>
                )}
                {sovDropdownOpen && sovSearch.trim() !== "" && sovMatches.length === 0 && (
                  <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-md shadow-lg p-3">
                    <p className="text-sm text-muted-foreground">No matching SOV items</p>
                  </div>
                )}
              </div>

              {/* ── Added billing items table ──────────────────────────── */}
              {billingItems.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/60 py-10 text-center">
                  <Receipt className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">No billing items added yet</p>
                  <p className="text-xs text-muted-foreground/70 mt-1">Click a division above or search to add billing items</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Selected Items ({billingItems.length})
                    </p>
                  </div>
                  <div className="overflow-auto max-h-[20rem] -mx-1">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card z-10">
                        <tr className="border-b border-border text-left">
                          <th className="pb-2.5 pr-3 font-medium text-muted-foreground text-xs uppercase tracking-wider w-20">Code</th>
                          <th className="pb-2.5 pr-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Description</th>
                          <th className="pb-2.5 pr-3 font-medium text-muted-foreground text-xs uppercase tracking-wider text-right w-36">Amount</th>
                          <th className="pb-2.5 w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {billingItems.map((item, idx) => (
                          <tr key={`sov-${item.code ?? idx}`} className="border-b border-border/40 last:border-0 group">
                            <td className="py-2.5 pr-3">
                              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{item.code ?? (idx + 1)}</span>
                            </td>
                            <td className="py-2.5 pr-3 text-sm">{item.description}</td>
                            <td className="py-2.5 pr-3">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.amount || ""}
                                onChange={(e) =>
                                  setBillingItems((prev) => updateRow(prev, idx, { amount: parseFloat(e.target.value) || 0 }))
                                }
                                className="h-7 text-xs text-right w-full"
                                placeholder="$0.00"
                              />
                            </td>
                            <td className="py-2.5 text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                tabIndex={-1}
                                className="h-7 w-7 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                                onClick={() => removeBillingItem(idx)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="sticky bottom-0 bg-card z-10">
                        <tr>
                          <td colSpan={2} className="pt-3 text-sm font-medium text-right pr-3">Total</td>
                          <td className="pt-3 text-sm font-semibold text-right pr-3 tabular-nums">{fmt.format(billingTotal)}</td>
                          <td />
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </>
              )}

              <div className="mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setBillingItems((prev) => [
                      ...prev,
                      { item_number: prev.length + 1, description: "", amount: 0 },
                    ])
                  }
                >
                  Add Custom Line Item
                </Button>
              </div>
            </StepCard>
          )}

          {/* ═══════════════════════════════════════════════════════════════ */}
          {/* STEP 4 — Review & Verify                                      */}
          {/* ═══════════════════════════════════════════════════════════════ */}
          {step === 4 && (
            <StepCard
              title="Review & Submit"
              subtitle="Confirm all details before submitting"
              icon={<ShieldCheck className="h-5 w-5" />}
            >
              {/* ── Project Header ──────────────────────────────────────── */}
              <div className="rounded-lg bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 px-5 py-4 mb-6">
                <p className="text-lg font-semibold">
                  {formData.job_name || <span className="text-muted-foreground italic">Untitled Project</span>}
                </p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                  {formData.job_type === "Service" && (
                    <span className="text-xs text-muted-foreground">Service Job</span>
                  )}
                  {customer && (
                    <span className="text-xs text-muted-foreground">{customer}</span>
                  )}
                  {formData.estimate_number && (
                    <span className="text-xs font-mono text-muted-foreground">{formData.estimate_number}</span>
                  )}
                </div>
              </div>

              {/* ── Section Grid ────────────────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {/* Team */}
                <ReviewSection title="Team" icon={<Users className="h-3.5 w-3.5" />}>
                  <ReviewRow label="Project Manager" value={primaryPm?.name} />
                  <ReviewRow label="Superintendent" value={primarySuper?.name} />
                  {whoSoldUser && <ReviewRow label="Who Sold" value={whoSoldUser.name} />}
                </ReviewSection>

                {/* Details */}
                <ReviewSection title="Details" icon={<Building2 className="h-3.5 w-3.5" />}>
                  {formData.cost_center && (
                    <ReviewRow label="Cost Center" value={getSpectrumCostCenterLabel(formData.cost_center)} />
                  )}
                  <ReviewRow
                    label="Timeline"
                    value={
                      formData.start_date && formData.end_date
                        ? `${formData.start_date} → ${formData.end_date}`
                        : undefined
                    }
                    icon={<Clock className="h-3 w-3 text-muted-foreground" />}
                  />
                  <ReviewRow
                    label="Address"
                    value={addressInput}
                    icon={<MapPin className="h-3 w-3 text-muted-foreground" />}
                  />
                  <ReviewRow label="Photos Required" value={formData.photos_required ? "Yes" : "No"} />
                  <ReviewRow label="Closeout Type" value={(formData.closeout_type ?? "short") === "full" ? "Full" : "Short"} />
                </ReviewSection>

                {/* Budget */}
                <ReviewSection title="Budget" icon={<Layers className="h-3.5 w-3.5" />}>
                  <ReviewRow label="Phase Codes" value={`${phaseCodes.length} codes`} />
                  <ReviewRow
                    label="Total"
                    value={fmt.format(phaseTotal)}
                    icon={<DollarSign className="h-3 w-3 text-muted-foreground" />}
                  />
                </ReviewSection>

                {/* Billing */}
                <ReviewSection title="Billing" icon={<Receipt className="h-3.5 w-3.5" />}>
                  <ReviewRow label="Line Items" value={`${billingItems.filter((i) => i.description.trim()).length} items`} />
                  <ReviewRow
                    label="Total"
                    value={fmt.format(billingTotal)}
                    icon={<DollarSign className="h-3 w-3 text-muted-foreground" />}
                  />
                </ReviewSection>
              </div>

              {/* ── Phase Code Verification ─────────────────────────────── */}
              {phaseCodes.length > 0 && (
                <div className="border-t border-border pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Phase Code Verification</h3>
                    </div>
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        allPhaseCodesAcked ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
                      )}
                    >
                      {ackedCount} of {phaseCodes.length} verified
                    </span>
                  </div>

                  {/* Verification progress bar */}
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width,background-color] duration-500 ease-out",
                        allPhaseCodesAcked ? "bg-green-500" : "bg-primary",
                      )}
                      style={{ width: `${phaseCodes.length > 0 ? (ackedCount / phaseCodes.length) * 100 : 0}%` }}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground mb-4">
                    Click each phase code to confirm it is correct.
                  </p>

                  <div className="space-y-1.5 max-h-[24rem] overflow-y-auto">
                    {phaseCodes.map((pc, idx) => {
                      const id = getSpectrumPhaseCodeId(pc);
                      const isAcked = ackedPhaseCodes.has(id);
                      return (
                        <button
                          key={`${id}-${idx}`}
                          type="button"
                          onClick={() => toggleAck(id)}
                          className={cn(
                            "w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-[background-color,border-color] duration-200 cursor-pointer group",
                            isAcked
                              ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800/40"
                              : "bg-card border-border hover:bg-muted/50 hover:border-foreground/20",
                          )}
                        >
                          <span className="shrink-0">
                            {isAcked ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground/40 group-hover:text-muted-foreground" />
                            )}
                          </span>
                          <div className="flex-1 min-w-0 flex items-center gap-3">
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
                              {pc.phase_code}
                            </span>
                            <span className="text-sm truncate">{pc.description}</span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="text-xs text-muted-foreground">{pc.cost_type}</span>
                            <span className="text-sm font-medium tabular-nums w-24 text-right">
                              {fmt.format(pc.amount)}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-border/50">
                    <span className="text-sm font-medium text-muted-foreground">Total</span>
                    <span className="text-sm font-semibold tabular-nums w-24 text-right">{fmt.format(phaseTotal)}</span>
                  </div>

                  {!allPhaseCodesAcked && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-4 flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      All phase codes must be verified before submitting
                    </p>
                  )}
                </div>
              )}

              {/* ── Billing Item Verification ───────────────────────────── */}
              {activeBillingItems.length > 0 && (
                <div className="border-t border-border pt-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold">Billing Item Verification</h3>
                    </div>
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums",
                        allBillingAcked ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
                      )}
                    >
                      {billingAckedCount} of {activeBillingItems.length} verified
                    </span>
                  </div>

                  {/* Verification progress bar */}
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-4">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width,background-color] duration-500 ease-out",
                        allBillingAcked ? "bg-green-500" : "bg-primary",
                      )}
                      style={{ width: `${activeBillingItems.length > 0 ? (billingAckedCount / activeBillingItems.length) * 100 : 0}%` }}
                    />
                  </div>

                  <p className="text-xs text-muted-foreground mb-4">
                    Click each billing item to confirm it is correct.
                  </p>

                  <div className="space-y-1.5 max-h-[24rem] overflow-y-auto">
                    {activeBillingItems.map((item, idx) => {
                      const key = String(idx);
                      const isAcked = ackedBillingItems.has(key);
                      return (
                        <button
                          key={`billing-${item.code ?? idx}`}
                          type="button"
                          onClick={() => toggleBillingAck(key)}
                          className={cn(
                            "w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-[background-color,border-color] duration-200 cursor-pointer group",
                            isAcked
                              ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800/40"
                              : "bg-card border-border hover:bg-muted/50 hover:border-foreground/20",
                          )}
                        >
                          <span className="shrink-0">
                            {isAcked ? (
                              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                            ) : (
                              <Circle className="h-5 w-5 text-muted-foreground/40 group-hover:text-muted-foreground" />
                            )}
                          </span>
                          <div className="flex-1 min-w-0 flex items-center gap-3">
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded shrink-0">
                              {item.code ?? `#${idx + 1}`}
                            </span>
                            <span className="text-sm truncate">{item.description}</span>
                          </div>
                          <span className="text-sm font-medium tabular-nums w-24 text-right shrink-0">
                            {fmt.format(item.amount)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-end gap-3 mt-3 pt-3 border-t border-border/50">
                    <span className="text-sm font-medium text-muted-foreground">Total</span>
                    <span className="text-sm font-semibold tabular-nums w-24 text-right">{fmt.format(billingTotal)}</span>
                  </div>

                  {!allBillingAcked && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-4 flex items-center gap-1.5">
                      <Receipt className="h-3.5 w-3.5" />
                      All billing items must be verified before submitting
                    </p>
                  )}
                </div>
              )}
            </StepCard>
          )}
        </div>

        {/* ── Navigation Footer ──────────────────────────────────────────── */}
        <div className={cn("flex items-center justify-between shrink-0 mt-6", isModal ? "pb-2" : "pb-6")}>
          <Button
            type="button"
            variant="ghost"
            onClick={prev}
            disabled={step === 0}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </Button>

          <div className="flex items-center gap-3">
            {step < 4 ? (
              <Button
                type="button"
                onClick={next}
                disabled={!stepValid[step]}
                className="gap-1.5 min-w-[120px]"
              >
                Continue
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!allValid || createProject.isPending}
                className="gap-1.5 min-w-[160px]"
              >
                {createProject.isPending ? (
                  "Submitting..."
                ) : (
                  <>
                    Submit for Approval
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  // ── Modal vs Page Rendering ───────────────────────────────────────────────
  if (isModal) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="p-0 gap-0 max-w-[100vw] max-h-[100dvh] w-screen h-[100dvh] rounded-none border-0 sm:max-w-6xl sm:h-[min(92vh,60rem)] sm:w-full sm:rounded-xl sm:border"
          showCloseButton
        >
          {wizardContent}
        </DialogContent>
      </Dialog>
    );
  }

  return wizardContent;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StepCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col rounded-xl border border-border bg-card/80 backdrop-blur-sm shadow-sm">
      <div className="px-6 py-5 border-b border-border/60 shrink-0">
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center h-9 w-9 rounded-lg bg-primary/10 text-primary">
            {icon}
          </span>
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
      </div>
      <div className="px-6 py-5 flex-1 min-h-0 overflow-y-auto">{children}</div>
    </div>
  );
}

function ReviewSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      <div className="px-4 py-2.5 bg-muted/40 border-b border-border/40 flex items-center gap-2">
        <span className="text-primary">{icon}</span>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h4>
      </div>
      <div className="px-4 py-3 space-y-2">{children}</div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-sm font-medium text-right truncate flex items-center gap-1.5">
        {icon}
        {value || <span className="text-muted-foreground italic text-xs">Not set</span>}
      </span>
    </div>
  );
}
