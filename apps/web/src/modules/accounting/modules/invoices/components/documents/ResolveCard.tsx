import { useState } from "react";
import { armedAction, armedWarningFor, ResolveCardActions } from "./ResolveCardActions";
import { ResolveCardEvidence } from "./ResolveCardEvidence";
import { TONE_ICONS } from "./resolveCardIcons";
import type { ResolveActionHandler, ResolveCardModel } from "./resolveCardModel";

/** No `className` or `style`: the card's look is closed so cards cannot drift from the design. */
export interface ResolveCardProps {
  model: ResolveCardModel;
  onAction?: ResolveActionHandler;
}

/** One closed card for every resolve-tray issue: tone icon, title, context, sentence, evidence and actions from data. */
export function ResolveCard({ model, onAction }: ResolveCardProps) {
  const ToneIcon = TONE_ICONS[model.tone];
  const actions = model.actions ?? [];
  const [armedId, setArmedId] = useState<string | null>(null);
  const armed = armedAction(actions, armedId);
  const warning = armed ? armedWarningFor(model.armedWarning, armed.id) : undefined;
  return (
    <div
      data-tone={model.tone}
      data-resolve-kind={model.id}
      data-testid={model.testid}
      className="flex flex-col gap-2 rounded-[10px] border border-rc-line bg-card px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <div className="flex min-w-0 flex-[1_1_240px] items-center gap-[7px]">
          <span className="inline-flex shrink-0 text-rc-icon">
            <ToneIcon size={14} aria-hidden="true" />
          </span>
          <span className="whitespace-nowrap text-[12.5px] font-semibold text-foreground">{model.title}</span>
          {model.context ? <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">{`· ${model.context}`}</span> : null}
        </div>
        <ResolveCardActions tone={model.tone} actions={actions} fallback={model.fallback} armedWarning={model.armedWarning} onAction={onAction} onArmedChange={setArmedId} />
      </div>
      {warning ? <p className="m-0 text-xs font-medium leading-[1.45] text-rc-ink text-pretty">{warning}</p>
        : model.sentence ? <p className="m-0 text-xs leading-[1.45] text-muted-foreground text-pretty">{model.sentence}</p> : null}
      {model.evidence ? <ResolveCardEvidence evidence={model.evidence} /> : null}
    </div>
  );
}
