import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Activity } from 'lucide-react';
import { MetricCard } from './MetricCard';
import skeletonStyles from '@/modules/shared/components/ui/skeleton.module.css';

describe('MetricCard', () => {
  it('renders label and value', () => {
    render(<MetricCard label="Active Projects" value={12} />);
    expect(screen.getByText('Active Projects')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders string values', () => {
    render(<MetricCard label="Revenue" value="$1.2M" />);
    expect(screen.getByText('$1.2M')).toBeInTheDocument();
  });

  it('renders an icon when provided', () => {
    const { container } = render(<MetricCard label="Test" value={5} icon={Activity} />);
    // lucide renders an <svg> element
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('applies tone classes when active', () => {
    const { container } = render(
      <MetricCard label="Alerts" value={3} icon={Activity} tone="red" active />,
    );
    // The value should get the tone text class
    expect(screen.getByText('3').className).toContain('text-tone-red');
    // The glyph wrapper should get tinted bg
    const glyphWrapper = container.querySelector('.bg-tone-red\\/15');
    expect(glyphWrapper).toBeInTheDocument();
  });

  it('does not apply tone classes when not active', () => {
    render(<MetricCard label="OK" value={0} icon={Activity} tone="red" />);
    expect(screen.getByText('0').className).not.toContain('text-tone-red');
  });

  it('renders all 7 tone variants without error', () => {
    const tones = ['cyan', 'emerald', 'amber', 'orange', 'violet', 'red', 'blue'] as const;
    for (const tone of tones) {
      const { unmount } = render(
        <MetricCard label={tone} value={1} tone={tone} active icon={Activity} />,
      );
      expect(screen.getByText(tone)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders the shared shimmer class when active and pulsing', () => {
    const { container } = render(
      <MetricCard label="Alert" value={1} icon={Activity} tone="amber" active pulsing />,
    );
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('class')).toContain(skeletonStyles.shimmer);
    expect(svg?.getAttribute('class')).not.toContain(['animate', 'pulse'].join('-'));
  });

  it('renders delta with up direction', () => {
    render(<MetricCard label="Rev" value={100} delta={{ dir: 'up', label: '+12%' }} />);
    expect(screen.getByText('+12%')).toBeInTheDocument();
  });

  it('renders delta with down direction', () => {
    render(<MetricCard label="Rev" value={80} delta={{ dir: 'down', label: '-5%' }} />);
    expect(screen.getByText('-5%')).toBeInTheDocument();
  });

  it('renders as a link when href is provided', () => {
    const { container } = render(<MetricCard label="Link" value={1} href="/test" />);
    const anchor = container.querySelector('a[href="/test"]');
    expect(anchor).toBeInTheDocument();
  });

  it('renders as a button and fires onClick', async () => {
    const onClick = vi.fn();
    render(<MetricCard label="Click" value={1} onClick={onClick} />);
    await userEvent.click(screen.getByText('1'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders as a static div when no href or onClick', () => {
    const { container } = render(<MetricCard label="Static" value={1} />);
    expect(container.querySelector('a')).not.toBeInTheDocument();
    expect(container.querySelector('button')).not.toBeInTheDocument();
    expect(container.querySelector('div')).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(<MetricCard label="X" value={1} className="custom-class" />);
    expect(container.firstElementChild?.className).toContain('custom-class');
  });
});
