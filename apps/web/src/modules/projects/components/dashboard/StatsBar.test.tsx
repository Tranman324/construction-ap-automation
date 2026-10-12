import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StatsBar } from './StatsBar';

// ─── Mock the query hook ──────────────────────────────────────────────────────
const mockStats = vi.hoisted(() =>
  vi.fn(() => ({
    data: {
      activeProjects: 12,
      pendingApproval: 3,
      needsAttention: 2,
      closeoutsInProgress: 1,
      checklistsPending: 5,
      checklistsTotal: 20,
      qualityChecksOverdue: 1,
      qualityOpenActions: 2,
    },
    isLoading: false,
  })),
);

vi.mock('@/modules/projects/hooks/queries', () => ({
  useProjectStats: mockStats,
}));

describe('StatsBar', () => {
  it('renders all six stat labels with correct values', () => {
    render(<StatsBar />);

    expect(screen.getByText('Active Projects')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();

    expect(screen.getByText('Pending Approval')).toBeInTheDocument();
    // pendingApproval = 3, qualityIssues = 3 — use getAllByText
    expect(screen.getAllByText('3')).toHaveLength(2);

    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    expect(screen.getByText('Closeouts In Progress')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    expect(screen.getByText('Field Checklists Pending')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    expect(screen.getByText('QC Open Items')).toBeInTheDocument();
    // QC value = qualityChecksOverdue (1) + qualityOpenActions (2) = 3, already counted above
  });

  it('shows Checklist Completion instead of Active Projects for superintendents', () => {
    render(<StatsBar isSuperintendent />);

    expect(screen.queryByText('Active Projects')).not.toBeInTheDocument();
    expect(screen.getByText('Checklist Completion')).toBeInTheDocument();
    // (20 - 5) / 20 = 75%
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('renders Pending Approval as a link to /projects/pending', () => {
    render(<StatsBar />);

    const link = screen.getByRole('link', { name: /pending approval/i });
    expect(link).toHaveAttribute('href', '/projects/pending');
  });

  it('renders loading skeletons while data is fetching', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockStats.mockReturnValueOnce({ data: undefined, isLoading: true } as any);
    const { container } = render(<StatsBar />);

    // Should have skeleton placeholders, not metric labels
    expect(screen.queryByText('Active Projects')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[class*="skeleton"], [data-slot="skeleton"]').length).toBeGreaterThanOrEqual(4);
  });

  it('defaults to zero when stats are undefined', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockStats.mockReturnValueOnce({ data: {} as any, isLoading: false });
    render(<StatsBar />);

    expect(screen.getByText('Active Projects')).toBeInTheDocument();
    // All values should fall back to 0
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBeGreaterThanOrEqual(5);
  });
});
