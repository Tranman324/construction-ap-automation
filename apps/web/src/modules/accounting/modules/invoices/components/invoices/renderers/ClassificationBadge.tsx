import {
  AlertCircle,
  BadgeCheck,
  Ban,
  BookText,
  ChevronsRight,
  ClipboardList,
  CreditCard,
  File,
  FileCheck,
  FilePen,
  FileX,
  Handshake,
  Image,
  Receipt,
  Shield,
  ShieldCheck,
  SkipForward,
  ShoppingCart,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { ClassificationType } from "@/modules/accounting/modules/invoices/types/invoice";
import { useClassifications } from "@/modules/accounting/modules/invoices/hooks/queries";

export interface ClassificationDisplay {
  label: string;
  Icon: LucideIcon;
}

const CLASSIFICATION_ICONS: Partial<Record<ClassificationType, LucideIcon>> = {
  invoice: Receipt, receipt: Receipt, "pay-application": ClipboardList,
  "credit-memo": CreditCard, subcontract: FileCheck, warranty: BadgeCheck,
  statement: BookText, coi: ShieldCheck, "building-permit": ClipboardList,
  w9: UserRound, contract: Handshake, "lien-waiver": Shield,
  "change-order": FilePen, "purchase-order": ShoppingCart, other: File,
  "no-attachment": FileX, skipped: SkipForward, unsupported: Ban,
  image: Image, error: AlertCircle, "all-skipped": ChevronsRight,
};

interface ClassificationBadgeProps {
  classification: string;
}

export function getClassificationDisplay(classification: string, label?: string): ClassificationDisplay {
  return {
    label: label ?? "Classification unavailable",
    Icon: CLASSIFICATION_ICONS[classification as ClassificationType] ?? File,
  };
}

export function ClassificationBadge({ classification }: ClassificationBadgeProps) {
  const { classifications, isError, isLoading } = useClassifications();
  const servedLabel = classifications.find((item) => item.name === classification)?.label;
  const display = getClassificationDisplay(
    classification,
    !isError && !isLoading ? servedLabel : undefined,
  );
  const { label, Icon } = display;

  return (
    <span className="inv-class" title={label}>
      <Icon className="inv-class__icon" aria-hidden="true" />
      {label}
    </span>
  );
}
