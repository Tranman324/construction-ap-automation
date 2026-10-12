"use client";

import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

interface FloatingResolveRegionProps {
  children: ReactNode;
  tray?: ReactNode;
  /** The scrolling child; its classic scrollbar width offsets the overlay so the tray never covers the scrollbar. */
  scrollRef?: RefObject<HTMLElement | null>;
}

/** The overlay and scroll clearance share one measurement, never percentage-sized nested slots. */
export function FloatingResolveRegion({ children, tray, scrollRef }: FloatingResolveRegionProps) {
  const shell = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = overlay.current;
    const update = () => {
      const scroller = scrollRef?.current;
      const scrollbar = scroller ? Math.max(0, scroller.offsetWidth - scroller.clientWidth) : 0;
      shell.current?.style.setProperty("--resolve-tray-height", `${element?.getBoundingClientRect().height ?? 0}px`);
      shell.current?.style.setProperty("--resolve-tray-scrollbar", `${scrollbar}px`);
    };
    update();
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    const scroller = scrollRef?.current;
    if (scroller) {
      observer.observe(scroller);
      // Content growth can add a scrollbar without resizing the scroller box itself.
      Array.from(scroller.children).forEach((child) => observer.observe(child));
    }
    return () => observer.disconnect();
  }, [tray, scrollRef]);
  return <div ref={shell} className="relative flex min-h-0 flex-1 flex-col" data-testid="floating-resolve-region">
    {children}
    {tray ? <div ref={overlay} data-region="resolve-tray" className="absolute bottom-0 left-0 right-[var(--resolve-tray-scrollbar,0px)] z-10 max-h-[60%] overflow-y-auto empty:hidden">{tray}</div> : null}
  </div>;
}
