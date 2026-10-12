import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatGrid } from './StatGrid';

describe('StatGrid', () => {
  it('renders children', () => {
    render(
      <StatGrid>
        <div>Card 1</div>
        <div>Card 2</div>
      </StatGrid>,
    );
    expect(screen.getByText('Card 1')).toBeInTheDocument();
    expect(screen.getByText('Card 2')).toBeInTheDocument();
  });

  it('defaults to 4-column grid', () => {
    const { container } = render(<StatGrid><div>child</div></StatGrid>);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toContain('lg:grid-cols-4');
  });

  it('applies the correct grid class for each col count', () => {
    const cases: Array<{ cols: 2 | 3 | 4 | 5 | 6; expected: string }> = [
      { cols: 2, expected: 'sm:grid-cols-2' },
      { cols: 3, expected: 'lg:grid-cols-3' },
      { cols: 5, expected: 'lg:grid-cols-5' },
      { cols: 6, expected: 'xl:grid-cols-6' },
    ];
    for (const { cols, expected } of cases) {
      const { container, unmount } = render(<StatGrid cols={cols}><div>x</div></StatGrid>);
      expect((container.firstElementChild as HTMLElement).className).toContain(expected);
      unmount();
    }
  });

  it('passes className through', () => {
    const { container } = render(<StatGrid className="extra"><div>x</div></StatGrid>);
    expect((container.firstElementChild as HTMLElement).className).toContain('extra');
  });
});
