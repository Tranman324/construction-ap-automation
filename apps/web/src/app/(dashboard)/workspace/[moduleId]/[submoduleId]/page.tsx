import { findModuleById, findSubmoduleById } from "@/modules/shared/lib/moduleRegistry";

interface BlankSubmodulePageProps {
  params: Promise<{
    moduleId: string;
    submoduleId: string;
  }>;
}

function toTitle(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

export default async function BlankSubmodulePage({ params }: BlankSubmodulePageProps) {
  const { moduleId, submoduleId } = await params;
  const registryModule = findModuleById(moduleId);
  const submodule = findSubmoduleById(moduleId, submoduleId);
  const moduleLabel = registryModule?.label ?? toTitle(moduleId);
  const submoduleLabel = submodule?.label ?? toTitle(submoduleId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border/60 bg-card/40 px-4 py-4 backdrop-blur-sm">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">{moduleLabel}</p>
          <h1 className="mt-1 text-lg font-semibold text-foreground">{submoduleLabel}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="rounded-xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
          <p className="text-sm text-muted-foreground">Blank slate for {submoduleLabel}.</p>
        </div>
      </div>
    </div>
  );
}