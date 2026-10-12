import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTablePattern } from './DataTablePattern';

describe('DataTablePattern', () => {
  it('keeps search and filters in the toolbar by default', () => {
    render(<DataTablePattern search={{value:''}} filters={<button>All jobs</button>} tabFilters={<button>All types</button>} />);
    expect(screen.getByPlaceholderText('Search…').closest('[data-dtp-toolbar="true"]')).not.toBeNull();
    expect(screen.getByRole('button', {name:'All jobs'}).closest('[data-dtp-toolbar="true"]')).not.toBeNull();
    expect(screen.getByRole('button', {name:'All types'}).closest('[data-dtp-toolbar="true"]')).toBeNull();
  });

  it('moves only search and filters beside tab filters, preserving handlers and toolbar actions', async () => {
    const onSearch = vi.fn();
    const onJob = vi.fn();
    render(<DataTablePattern search={{value:'',onChange:onSearch}}
      filters={<button onClick={onJob}>All jobs</button>} toolbarActions={<button>Settings</button>}
      tabFilters={<button>All types</button>} searchFiltersPosition="tab-filters" tabFiltersPosition="after-tabs" />);
    const input = screen.getByPlaceholderText('Search…');
    const job = screen.getByRole('button', {name:'All jobs'});
    const strip = screen.getByRole('button', {name:'All types'}).closest('[data-dtp-tabfilters="true"]');
    expect(input.closest('[data-dtp-tabfilters="true"]')).toBe(strip);
    expect(job.closest('[data-dtp-tabfilters="true"]')).toBe(strip);
    expect(job.closest('[data-dtp-searchfilters="true"]')).toHaveClass('ml-auto', 'justify-end');
    expect(screen.getAllByPlaceholderText('Search…')).toHaveLength(1);
    expect(screen.getByRole('button', {name:'Settings'}).closest('[data-dtp-toolbar="true"]')).not.toBeNull();
    await userEvent.type(input, 'x');
    expect(onSearch).toHaveBeenCalledWith('x');
    await userEvent.click(job);
    expect(onJob).toHaveBeenCalledOnce();
  });

  it('renders relocated search without requiring tab filters or an empty toolbar', () => {
    const {container} = render(<DataTablePattern search={{value:''}} searchFiltersPosition="tab-filters" tabFiltersPosition="after-tabs" />);
    expect(container.querySelector('[data-dtp-toolbar="true"]')).toBeNull();
    expect(screen.getByPlaceholderText('Search…').closest('[data-dtp-surface="table"]')).not.toBeNull();
  });

  it('renders title and children', () => {
    const { container } = render(
      <DataTablePattern title="Invoices">
        <table><tbody><tr><td>Row 1</td></tr></tbody></table>
      </DataTablePattern>,
    );
    expect(screen.getByText('Invoices')).toBeInTheDocument();
    expect(screen.getByText('Row 1')).toBeInTheDocument();
    expect(container.querySelector('[data-dtp-surface="table"]')).toBeInTheDocument();
  });

  it('renders subtitle', () => {
    render(
      <DataTablePattern title="Projects" subtitle="All active projects">
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByText('All active projects')).toBeInTheDocument();
  });

  it('renders search input with placeholder', () => {
    render(
      <DataTablePattern search={{ value: '', placeholder: 'Search vendors…' }}>
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByPlaceholderText('Search vendors…')).toBeInTheDocument();
  });

  it('calls search.onChange on input', async () => {
    const onChange = vi.fn();
    render(
      <DataTablePattern search={{ value: '', onChange, placeholder: 'Search…' }}>
        <div />
      </DataTablePattern>,
    );
    await userEvent.type(screen.getByPlaceholderText('Search…'), 'test');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders tabs with counts', () => {
    const tabs = [
      { value: 'all', label: 'All', count: 42 },
      { value: 'pending', label: 'Pending', count: 5 },
    ];
    render(
      <DataTablePattern tabs={tabs} activeTab="all">
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByRole('tab', { name: /All/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Pending/i })).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('calls onTabChange when a tab is clicked', async () => {
    const onTabChange = vi.fn();
    const tabs = [
      { value: 'all', label: 'All' },
      { value: 'draft', label: 'Draft' },
    ];
    render(
      <DataTablePattern tabs={tabs} activeTab="all" onTabChange={onTabChange}>
        <div />
      </DataTablePattern>,
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Draft' }));
    expect(onTabChange).toHaveBeenCalledWith('draft');
  });

  it('marks the active tab with aria-selected', () => {
    const tabs = [
      { value: 'all', label: 'All' },
      { value: 'draft', label: 'Draft' },
    ];
    render(
      <DataTablePattern tabs={tabs} activeTab="draft">
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByRole('tab', { name: 'Draft' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'false');
  });

  it('renders trash button with count', () => {
    const onClick = vi.fn();
    render(
      <DataTablePattern trash={{ count: 3, onClick }}>
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByText('Trash')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('marks the separated trash control active', () => {
    render(
      <DataTablePattern trash={{ count: 3, active: true }}>
        <div />
      </DataTablePattern>,
    );

    expect(screen.getByRole('button', { name: /Trash/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders the bulk-action bar when selection.count > 0', () => {
    render(
      <DataTablePattern selection={{ count: 5, actions: <button>Approve</button>, onClear: vi.fn() }}>
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByText('5 selected')).toBeInTheDocument();
    expect(screen.getByText('Approve')).toBeInTheDocument();
    expect(screen.getByText('Clear')).toBeInTheDocument();
  });

  it('hides the bulk-action bar when selection.count is 0', () => {
    render(
      <DataTablePattern selection={{ count: 0, onClear: vi.fn() }}>
        <div />
      </DataTablePattern>,
    );
    expect(screen.queryByText('selected')).not.toBeInTheDocument();
  });

  it('calls onClear when Clear button is clicked', async () => {
    const onClear = vi.fn();
    render(
      <DataTablePattern selection={{ count: 2, onClear }}>
        <div />
      </DataTablePattern>,
    );
    await userEvent.click(screen.getByText('Clear'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('renders toolbar actions slot', () => {
    render(
      <DataTablePattern toolbarActions={<button>Export CSV</button>}>
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByText('Export CSV')).toBeInTheDocument();
  });

  it('renders filters slot', () => {
    render(
      <DataTablePattern filters={<select><option>All</option></select>}>
        <div />
      </DataTablePattern>,
    );
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('renders tab filters between the toolbar and tabs', () => {
    const { container } = render(
      <DataTablePattern
        search={{ value: '' }}
        tabFilters={<button>All Types</button>}
        tabs={[{ value: 'pending', label: 'Pending' }]}
        activeTab="pending"
      >
        <div />
      </DataTablePattern>,
    );

    const toolbar = container.querySelector('[data-dtp-toolbar="true"]');
    const tabFilters = container.querySelector('[data-dtp-tabfilters="true"]');
    const tabs = container.querySelector('[data-dtp-tabsrow="true"]');

    expect(screen.getByRole('button', { name: 'All Types' })).toBeInTheDocument();
    expect(toolbar).not.toBeNull();
    expect(tabFilters).not.toBeNull();
    expect(tabs).not.toBeNull();
    expect(toolbar!.compareDocumentPosition(tabFilters!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabFilters!.compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tabFilters!.closest('[data-dtp-surface="table"]')).toBeNull();
  });

  it('can place tab filters beneath the tabs for queue-specific controls', () => {
    const { container } = render(
      <DataTablePattern
        tabFiltersPosition="after-tabs"
        tabFilters={<button>All types</button>}
        tabs={[{ value: 'pending', label: 'Pending' }]}
        activeTab="pending"
      >
        <div />
      </DataTablePattern>,
    );

    const tabFilters = container.querySelector('[data-dtp-tabfilters="true"]');
    const tabs = container.querySelector('[data-dtp-tabsrow="true"]');
    expect(tabs!.compareDocumentPosition(tabFilters!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const surface = container.querySelector('[data-dtp-surface="table"]');
    expect(tabFilters!.parentElement).toBe(surface);
    expect(surface!.firstElementChild).toBe(tabFilters);
  });
});
