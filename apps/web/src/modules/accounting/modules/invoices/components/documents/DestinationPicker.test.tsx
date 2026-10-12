import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { DestinationPicker } from "@/modules/accounting/modules/invoices/components/documents/DestinationPicker";
import { SEEDED_DESTINATIONS } from "@/modules/accounting/modules/invoices/lib/destinationsFixture";

// Wrap in a QueryClient whose ["document-destinations"] cache is pre-seeded with
// the served catalog, so the picker's useDocumentDestinations resolves rootLabel
// + tree without hitting the network.
function makeSeededWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  queryClient.setQueryData(["document-destinations"], SEEDED_DESTINATIONS);
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { queryClient, Wrapper };
}

// ─── Mock the api module ─────────────────────────────────────────────────────

vi.mock("@/modules/shared/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

import { api } from "@/modules/shared/lib/api";
const mockApi = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  put: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
};

// ─── Static fallback tests (original behavior with explicit tree prop) ───────

function renderStaticPicker(onChange = vi.fn()) {
  const { Wrapper } = makeSeededWrapper();
  render(
    <DestinationPicker
      value="01 Contracts / Subcontracts"
      onChange={onChange}
      jobId="24-014"
      jobName="North Tower"
      note="Defaults to the Subcontracts folder."
      tree={SEEDED_DESTINATIONS.tree}
    />,
    { wrapper: Wrapper },
  );
  return onChange;
}

describe("DestinationPicker (static fallback)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("opens, navigates, uses breadcrumbs, and confirms a selected folder", async () => {
    const user = userEvent.setup();
    const onChange = renderStaticPicker();

    await user.click(screen.getByRole("button", { name: "Browse" }));
    expect(screen.getByRole("heading", { name: "Choose a SharePoint folder" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Go to 24-014 root" }));
    await user.click(screen.getByRole("button", { name: "Open 04 Closeout" }));
    await user.click(screen.getByRole("button", { name: "Open Warranties" }));
    expect(screen.getByRole("status")).toHaveTextContent("This folder is empty.");

    await user.click(screen.getByRole("button", { name: "Go to 04 Closeout" }));
    expect(screen.getByRole("button", { name: "Open O&M Manuals" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open Warranties" }));
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));

    expect(onChange).toHaveBeenCalledWith("04 Closeout / Warranties");
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Choose a SharePoint folder" })).not.toBeInTheDocument();
    });
  });

  it("preserves the prior selected path when canceled", async () => {
    const user = userEvent.setup();
    const onChange = renderStaticPicker();

    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(screen.getByRole("button", { name: "Go to 24-014 root" }));
    await user.click(screen.getByRole("button", { name: "Open 99 Archive" }));
    expect(screen.getByRole("status")).toHaveTextContent("This folder is empty.");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("01 Contracts / Subcontracts")).toBeInTheDocument();
  });

  it("closes without changing value when the Sheet close control is used", async () => {
    const user = userEvent.setup();
    const onChange = renderStaticPicker();

    await user.click(screen.getByRole("button", { name: "Browse" }));
    await user.click(screen.getByRole("button", { name: "Go to 24-014 root" }));
    await user.click(screen.getByRole("button", { name: "Open 02 Financials" }));
    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Choose a SharePoint folder" })).not.toBeInTheDocument();
    });
  });
});

// ─── Live browse tests (mock API layer) ──────────────────────────────────────

const JOB_FOLDER = "26-000/26-434 - Brightwater North";

const folderResponses: Record<string, {
  path: string;
  folders: Array<{ id: string; name: string; hasChildren: null }>;
  files?: Array<{ id: string; name: string; webUrl?: string | null }>;
}> = {
  [JOB_FOLDER]: {
    path: JOB_FOLDER,
    folders: [
      { id: "c1", name: "01 Contracts", hasChildren: null },
      { id: "c2", name: "02 Financials", hasChildren: null },
      { id: "c3", name: "03 Insurance", hasChildren: null },
    ],
    files: [
      { id: "file-1", name: "Existing COI.pdf", webUrl: "https://sharepoint.example/Existing%20COI.pdf" },
    ],
  },
  [`${JOB_FOLDER}/02 Financials`]: {
    path: `${JOB_FOLDER}/02 Financials`,
    folders: [
      { id: "d1", name: "Pay Applications", hasChildren: null },
      { id: "d2", name: "Lien Waivers", hasChildren: null },
    ],
    files: [
      { id: "file-2", name: "Stored pay app.xlsx", webUrl: null },
    ],
  },
  "26-000": {
    path: "26-000",
    folders: [
      { id: "y1", name: "26-434 - Brightwater North", hasChildren: null },
      { id: "y2", name: "26-435 - Another Job", hasChildren: null },
    ],
  },
  "": {
    path: "",
    folders: [
      { id: "r1", name: "25-000", hasChildren: null },
      { id: "r2", name: "26-000", hasChildren: null },
    ],
  },
};

function setupLiveMocks() {
  mockApi.get.mockImplementation((url: string, params?: Record<string, unknown>) => {
    if (url.includes("/api/jobs/") && url.endsWith("/folders") && !url.includes("sharepoint")) {
      // Job folders endpoint: GET /api/jobs/:jobNumber/folders
      return Promise.resolve({
        jobNumber: "26-434",
        jobFolder: JOB_FOLDER,
        folders: [
          { id: "f1", name: "01 Contracts", children: [] },
          { id: "f2", name: "02 Financials", children: [] },
        ],
      });
    }
    if (url.includes("/api/jobs/sharepoint/folders")) {
      // SharePoint browsing endpoint
      const path = (params?.path as string) ?? "";
      const response = folderResponses[path];
      if (response) return Promise.resolve(response);
      return Promise.resolve({ path, folders: [], files: [] });
    }
    return Promise.reject(new Error(`Unmocked GET: ${url}`));
  });
}

function renderLivePicker(onChange = vi.fn(), onChangePath = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  queryClient.setQueryData(["document-destinations"], SEEDED_DESTINATIONS);
  function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children);
  }

  render(
    <DestinationPicker
      value="(Job root)"
      onChange={onChange}
      onChangePath={onChangePath}
      jobId="26-434"
      jobName="Brightwater North"
      note="Browse the live SharePoint folder."
    />,
    { wrapper: Wrapper },
  );
  return { onChange, onChangePath };
}

describe("DestinationPicker (live browse)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setupLiveMocks();
  });

  it("opens at job folder, shows live children, navigates into subfolders", async () => {
    const user = userEvent.setup();
    const { onChange, onChangePath } = renderLivePicker();

    // Wait for job folders query to resolve so picker switches to live mode.
    // The description text changes to include "(live)" only in live mode.
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });
    // Let React settle after the query resolves
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Browse" }));
    expect(screen.getByRole("heading", { name: "Choose a SharePoint folder" })).toBeInTheDocument();

    // Should show live children of the job folder
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open 01 Contracts" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open 02 Financials" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open 03 Insurance" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open file Existing COI.pdf" }))
      .toHaveAttribute("href", "https://sharepoint.example/Existing%20COI.pdf");

    // Navigate into Financials
    await user.click(screen.getByRole("button", { name: "Open 02 Financials" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open Pay Applications" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open Lien Waivers" })).toBeInTheDocument();
    expect(screen.getByText("Stored pay app.xlsx")).toBeInTheDocument();

    // Save to this folder
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));

    // Since we're inside the job folder, display path should be relative
    expect(onChange).toHaveBeenCalledWith("02 Financials");
    expect(onChangePath).toHaveBeenCalledWith(`${JOB_FOLDER}/02 Financials`);
  });

  it("breadcrumbs allow navigating up to drive root", async () => {
    const user = userEvent.setup();
    const { onChange, onChangePath } = renderLivePicker();

    // Wait for live mode
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Browse" }));

    // Wait for initial folder load
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open 01 Contracts" })).toBeInTheDocument();
    });

    // Breadcrumbs should show: Projects > 26-000 > 26-434 - Brightwater North
    expect(screen.getByRole("button", { name: "Go to Projects root" })).toBeInTheDocument();

    // Navigate to drive root via breadcrumb
    await user.click(screen.getByRole("button", { name: "Go to Projects root" }));

    // Should show year buckets at root
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open 25-000" })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Open 26-000" })).toBeInTheDocument();

    // Navigate into 26-000
    await user.click(screen.getByRole("button", { name: "Open 26-000" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open 26-434 - Brightwater North" })).toBeInTheDocument();
    });

    // Confirm selection at year bucket level
    await user.click(screen.getByRole("button", { name: "Save to this folder" }));

    // Outside job folder → should prefix with "Projects / "
    expect(onChange).toHaveBeenCalledWith("Projects / 26-000");
    expect(onChangePath).toHaveBeenCalledWith("26-000");
  });

  it("shows error state on fetch failure but navigation still works", async () => {
    const user = userEvent.setup();

    // Override to fail for job folder path
    mockApi.get.mockImplementation((url: string, params?: Record<string, unknown>) => {
      if (url.includes("/api/jobs/") && url.endsWith("/folders") && !url.includes("sharepoint")) {
        return Promise.resolve({
          jobNumber: "26-434",
          jobFolder: JOB_FOLDER,
          folders: [],
        });
      }
      if (url.includes("/api/jobs/sharepoint/folders")) {
        const path = (params?.path as string) ?? "";
        if (path === JOB_FOLDER) {
          return Promise.reject(new Error("Graph error"));
        }
        if (path === "") {
          return Promise.resolve({
            path: "",
            folders: [{ id: "r1", name: "25-000", hasChildren: null }],
          });
        }
        return Promise.resolve({ path, folders: [] });
      }
      return Promise.reject(new Error(`Unmocked GET: ${url}`));
    });

    renderLivePicker();

    // Wait for live mode
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Browse" }));

    // Should show error
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    // Can still navigate via breadcrumbs to drive root
    await user.click(screen.getByRole("button", { name: "Go to Projects root" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open 25-000" })).toBeInTheDocument();
    });
  });

  it("canceling does not call onChange", async () => {
    const user = userEvent.setup();
    const { onChange, onChangePath } = renderLivePicker();

    // Wait for live mode
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Browse" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Browse" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Open 01 Contracts" })).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Open 01 Contracts" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(onChangePath).not.toHaveBeenCalled();
  });
});
