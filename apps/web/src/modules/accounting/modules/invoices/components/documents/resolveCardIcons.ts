import {
  ChartColumn, Check, CircleAlert, CircleOff, CreditCard, ExternalLink, Info, Link, Mail, Plus,
  RefreshCw, Save, Scissors, Send, Trash2, TriangleAlert, type LucideIcon,
} from "lucide-react";
import type { ResolveIconName, Tone } from "./resolveCardModel";

/** Closed map from action icon name to lucide component (13 names; the model file stays free of React). */
export const ACTION_ICONS: Record<ResolveIconName, LucideIcon> = {
  "bar-chart": ChartColumn, check: Check, "circle-off": CircleOff, "credit-card": CreditCard,
  "external-link": ExternalLink, link: Link, mail: Mail, plus: Plus, "refresh-cw": RefreshCw,
  save: Save, scissors: Scissors, send: Send, trash: Trash2,
};

/** Tone icon (no icon slot on the model): blocking alert-triangle, failed alert-circle, waiting mail, info info. */
export const TONE_ICONS: Record<Tone, LucideIcon> = {
  blocking: TriangleAlert, failed: CircleAlert, waiting: Mail, info: Info,
};
