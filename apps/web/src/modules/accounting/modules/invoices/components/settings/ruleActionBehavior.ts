// Pure UX/behavior maps (M-050 KEEP): which actions take no value, which are
// clearable, and action subtitles — display/UX logic, not served catalog data.

import type { RuleActionType } from "@/modules/accounting/modules/invoices/types/rules";

export interface RuleSelectOption<TValue extends string> {
  value: TValue;
  label: string;
}

export const ACTION_SUBTITLES: Partial<Record<RuleActionType, string>> = {
  auto_approve: "Marks invoice as approved automatically",
  auto_discard: "Marks invoice as discarded automatically",
  auto_file: "Moves invoice to the Documents shelf",
  hide_from_queue: "Hides invoice from the queue",
  flag: "Adds a flag badge to the invoice row",
  set_phase_code: "Pre-fills the phase code for Spectrum submission",
  set_gl_account: "Pre-fills the GL account for Spectrum submission",
  set_cost_type: "Pre-fills the cost type for Spectrum submission",
  set_routing_code: "Pre-fills the routing code for Spectrum submission",
};

export const VALUELESS_ACTIONS = new Set<RuleActionType>([
  "auto_approve",
  "auto_discard",
  "auto_file",
  "hide_from_queue",
  "flag",
]);

export const CLEARABLE_ACTIONS = new Set<RuleActionType>([
  "set_vendor",
  "set_job",
  "set_phase_code",
  "set_gl_account",
  "set_cost_type",
  "set_routing_code",
]);
