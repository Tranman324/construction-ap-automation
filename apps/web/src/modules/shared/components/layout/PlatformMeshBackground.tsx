"use client";

import { MeshGradient } from "@paper-design/shaders-react";
import { useSyncExternalStore } from "react";

interface PlatformBackgroundSnapshot {
  colors: string[];
  distortion: number;
  height: number;
  offsetX: number;
  ready: boolean;
  reducedMotion: boolean;
  speed: number;
  swirl: number;
  width: number;
}

const fallbackSnapshot: PlatformBackgroundSnapshot = {
  colors: ["#F8FAFC", "#FFFFFF", "#E6F7FE", "#00AEEF", "#1D2C5B", "#F1F5F9"],
  distortion: 1.12,
  height: 1080,
  offsetX: 0.06,
  ready: false,
  reducedMotion: false,
  speed: 0.18,
  swirl: 0.62,
  width: 1920,
};

let currentSnapshot = fallbackSnapshot;
const listeners = new Set<() => void>();
let stopListening: (() => void) | null = null;

function resolveCssColor(name: string, fallback: string): string {
  if (typeof document === "undefined") {
    return fallback;
  }

  const probe = document.createElement("span");
  probe.style.color = `var(${name}, ${fallback})`;
  probe.style.display = "none";
  (document.body ?? document.documentElement).appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  return resolved.startsWith("rgb") || resolved.startsWith("hsl") ? resolved : fallback;
}

function readCssNumber(name: string, fallback: number): number {
  if (typeof document === "undefined") {
    return fallback;
  }

  const rawValue = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parsedValue = Number.parseFloat(rawValue);

  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function createSnapshot(): PlatformBackgroundSnapshot {
  if (typeof window === "undefined") {
    return fallbackSnapshot;
  }

  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return {
    colors: [1, 2, 3, 4, 5, 6].map((index) =>
      resolveCssColor(`--app-mesh-${index}`, fallbackSnapshot.colors[index - 1] ?? "#F8FAFC"),
    ),
    distortion: readCssNumber("--app-mesh-distortion", fallbackSnapshot.distortion),
    height: window.innerHeight || fallbackSnapshot.height,
    offsetX: readCssNumber("--app-mesh-offset-x", fallbackSnapshot.offsetX),
    ready: true,
    reducedMotion: prefersReducedMotion,
    speed: readCssNumber("--app-mesh-speed", fallbackSnapshot.speed),
    swirl: readCssNumber("--app-mesh-swirl", fallbackSnapshot.swirl),
    width: window.innerWidth || fallbackSnapshot.width,
  };
}

function snapshotsAreEqual(first: PlatformBackgroundSnapshot, second: PlatformBackgroundSnapshot): boolean {
  return (
    first.width === second.width &&
    first.height === second.height &&
    first.ready === second.ready &&
    first.reducedMotion === second.reducedMotion &&
    first.distortion === second.distortion &&
    first.swirl === second.swirl &&
    first.speed === second.speed &&
    first.offsetX === second.offsetX &&
    first.colors.join("|") === second.colors.join("|")
  );
}

function emitSnapshotChange() {
  const nextSnapshot = createSnapshot();

  if (snapshotsAreEqual(currentSnapshot, nextSnapshot)) {
    return;
  }

  currentSnapshot = nextSnapshot;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  if (!stopListening && typeof window !== "undefined") {
    const reducedMotionQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const themeObserver =
      typeof MutationObserver !== "undefined" ? new MutationObserver(emitSnapshotChange) : null;

    window.addEventListener("resize", emitSnapshotChange);
    reducedMotionQuery?.addEventListener("change", emitSnapshotChange);
    themeObserver?.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });

    stopListening = () => {
      window.removeEventListener("resize", emitSnapshotChange);
      reducedMotionQuery?.removeEventListener("change", emitSnapshotChange);
      themeObserver?.disconnect();
    };
  }

  emitSnapshotChange();

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) {
      stopListening?.();
      stopListening = null;
    }
  };
}

function getSnapshot(): PlatformBackgroundSnapshot {
  return currentSnapshot;
}

function getServerSnapshot(): PlatformBackgroundSnapshot {
  return fallbackSnapshot;
}

export function PlatformMeshBackground() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  return (
    <div className="tbx-platform-background" aria-hidden="true" data-testid="platform-mesh-background">
      <div className="tbx-platform-background__fallback" />
      {snapshot.ready && !snapshot.reducedMotion ? (
        <MeshGradient
          className="tbx-platform-background__mesh"
          colors={snapshot.colors}
          distortion={snapshot.distortion}
          grainMixer={0}
          grainOverlay={0}
          height={snapshot.height}
          maxPixelCount={1_000_000}
          offsetX={snapshot.offsetX}
          speed={snapshot.speed}
          swirl={snapshot.swirl}
          width={snapshot.width}
        />
      ) : null}
      <div className="tbx-platform-background__veil" />
    </div>
  );
}
