import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Calendar, FileText } from 'lucide-react';
import { DetailPage } from './DetailPage';

describe('DetailPage', () => {
  it('renders title and back button', () => {
    render(<DetailPage title="Project Alpha" onBack={vi.fn()} />);
    expect(screen.getByText('Project Alpha')).toBeInTheDocument();
    expect(screen.getByText('Back')).toBeInTheDocument();
  });

  it('renders custom back label', () => {
    render(<DetailPage title="Detail" backLabel="Return" onBack={vi.fn()} />);
    expect(screen.getByText('Return')).toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const onBack = vi.fn();
    render(<DetailPage title="Detail" onBack={onBack} />);
    await userEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('renders eyebrow text', () => {
    render(<DetailPage title="INV-001" eyebrow="Invoice" />);
    expect(screen.getByText('Invoice')).toBeInTheDocument();
  });

  it('renders status slot', () => {
    render(<DetailPage title="Test" status={<span>Active</span>} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders meta items with icons', () => {
    const meta = [
      { icon: Calendar, label: 'Created', value: 'Jan 1' },
      { icon: FileText, label: 'Type', value: 'Residential' },
    ];
    render(<DetailPage title="Test" meta={meta} />);
    expect(screen.getByText('Jan 1')).toBeInTheDocument();
    expect(screen.getByText('Residential')).toBeInTheDocument();
  });

  it('renders actions slot', () => {
    render(<DetailPage title="Test" actions={<button>Edit</button>} />);
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });

  it('renders paging controls', () => {
    render(
      <DetailPage
        title="Item"
        paging={{ index: 2, total: 10, onPrev: vi.fn(), onNext: vi.fn() }}
      />,
    );
    expect(screen.getByText('3 of 10')).toBeInTheDocument();
    expect(screen.getByLabelText('Previous')).toBeInTheDocument();
    expect(screen.getByLabelText('Next')).toBeInTheDocument();
  });

  it('disables prev button at index 0', () => {
    render(
      <DetailPage
        title="Item"
        paging={{ index: 0, total: 5, onPrev: vi.fn(), onNext: vi.fn() }}
      />,
    );
    expect(screen.getByLabelText('Previous')).toBeDisabled();
    expect(screen.getByLabelText('Next')).not.toBeDisabled();
  });

  it('disables next button at last index', () => {
    render(
      <DetailPage
        title="Item"
        paging={{ index: 4, total: 5, onPrev: vi.fn(), onNext: vi.fn() }}
      />,
    );
    expect(screen.getByLabelText('Previous')).not.toBeDisabled();
    expect(screen.getByLabelText('Next')).toBeDisabled();
  });

  it('calls onPrev and onNext', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(
      <DetailPage
        title="Item"
        paging={{ index: 2, total: 5, onPrev, onNext }}
      />,
    );
    await userEvent.click(screen.getByLabelText('Previous'));
    expect(onPrev).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByLabelText('Next'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('renders tabs and calls onTabChange', async () => {
    const onTabChange = vi.fn();
    const tabs = [
      { value: 'overview', label: 'Overview' },
      { value: 'files', label: 'Files', icon: FileText },
    ];
    render(
      <DetailPage
        title="Project"
        tabs={tabs}
        activeTab="overview"
        onTabChange={onTabChange}
      />,
    );
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Files/i })).toBeInTheDocument();
    // Active tab styling
    expect(screen.getByRole('tab', { name: /Overview/i })).toHaveAttribute('aria-selected', 'true');
    // Click inactive tab
    await userEvent.click(screen.getByRole('tab', { name: /Files/i }));
    expect(onTabChange).toHaveBeenCalledWith('files');
  });

  it('renders children in the body', () => {
    render(
      <DetailPage title="Test">
        <div>Body content here</div>
      </DetailPage>,
    );
    expect(screen.getByText('Body content here')).toBeInTheDocument();
  });
});
