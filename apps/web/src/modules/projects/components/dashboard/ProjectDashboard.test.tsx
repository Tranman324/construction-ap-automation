import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDashboard } from "./ProjectDashboard";
import type { ProjectFilters } from "@/modules/projects/types/project";

const testState = vi.hoisted(() => ({
  push: vi.fn(),
  useProjects: vi.fn((filters?: ProjectFilters) => {
    const normalizedSearch = filters?.search?.toLowerCase() ?? "";
    const projects = [
      {
        id: "project-1",
        job_name: "Alpha Tower",
      },
      {
        id: "project-2",
        job_name: "Bravo Warehouse",
      },
    ].filter((project) => project.job_name.toLowerCase().includes(normalizedSearch));

    return {
      data: { data: projects },
      isLoading: false,
    };
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: testState.push }),
}));

vi.mock("@/modules/projects/hooks/queries", () => ({
  useCurrentUser: () => ({
    data: {
      id: "user-1",
      role: { name: "admin" },
    },
  }),
  useProjectStats: () => ({ data: {} }),
  useProjects: (filters?: ProjectFilters) => testState.useProjects(filters),
  useUsers: () => ({
    data: [
      { id: "pm-1", is_active: true, name: "Dana Brown", role: { name: "pm" } },
      { id: "super-1", is_active: true, name: "Maria Chen", role: { name: "superintendent" } },
    ],
  }),
}));

vi.mock("@/modules/projects/lib/permissions", () => ({
  canAccess: () => true,
}));

vi.mock("@/modules/projects/mock/index", () => ({
  getTeamForProject: () => [],
}));

vi.mock("@/modules/shared/components/ui/select", () => ({
  Select: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className}>{children}</button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
}));

vi.mock("@/modules/projects/components/dashboard/StatsBar", () => ({
  StatsBar: () => <div>Stats</div>,
}));

vi.mock("@/modules/projects/components/dashboard/ProjectCard", () => ({
  ProjectCard: ({ project }: { project: { job_name: string } }) => <div>{project.job_name}</div>,
}));

vi.mock("@/modules/projects/components/dashboard/MapboxMap", () => ({
  MapboxMap: () => <div>Map</div>,
}));

vi.mock("@/modules/projects/components/dashboard/SupervisorRollUp", () => ({
  SupervisorRollUp: () => <div>Supervisor Summary</div>,
}));

vi.mock("@/modules/projects/components/setup/JobSetupWizard", () => ({
  JobSetupWizard: () => null,
}));

vi.mock("@/modules/projects/components/dashboard/GanttChart", () => ({
  GanttChart: () => <div>Timeline</div>,
}));

vi.mock("@/modules/shared/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (checked: boolean) => void }) => (
    <button type="button" aria-pressed={checked} onClick={() => onCheckedChange(!checked)}>
      Show completed
    </button>
  ),
}));

describe("ProjectDashboard", () => {
  beforeEach(() => {
    testState.push.mockReset();
    testState.useProjects.mockClear();
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps project search inline and passes the debounced term into the project filters", async () => {
    render(<ProjectDashboard />);

    expect(screen.getByText("Alpha Tower")).toBeInTheDocument();
    expect(screen.getByText("Bravo Warehouse")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: /search projects/i }), {
      target: { value: "Alpha" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(testState.useProjects).toHaveBeenLastCalledWith(expect.objectContaining({ search: "Alpha" }));
    expect(screen.getByText("Alpha Tower")).toBeInTheDocument();
    expect(screen.queryByText("Bravo Warehouse")).not.toBeInTheDocument();
  });
});