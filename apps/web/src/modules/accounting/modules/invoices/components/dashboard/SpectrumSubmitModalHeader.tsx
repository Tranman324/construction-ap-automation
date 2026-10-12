import { UploadCloud } from "lucide-react";

import {
  getSpectrumSubmitDialogDescription,
  type SpectrumSubmitConfirmSummary,
} from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitModalModel";
import type { SpectrumSubmitPhaseModel } from "@/modules/accounting/modules/invoices/components/dashboard/spectrumSubmitProgressModel";
import { DialogIconHeader } from "@/modules/shared/components/patterns";

interface SpectrumSubmitModalHeaderProps {
  phaseModel: SpectrumSubmitPhaseModel;
  summary: SpectrumSubmitConfirmSummary;
}

export function SpectrumSubmitModalHeader({
  phaseModel,
  summary,
}: SpectrumSubmitModalHeaderProps) {
  return (
    <DialogIconHeader
      icon={UploadCloud}
      title={phaseModel.phase === "results" ? "Spectrum submission complete" : summary.title}
      description={getSpectrumSubmitDialogDescription(phaseModel)}
    />
  );
}
