"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/modules/shared/lib/utils";
import {
  createParticles,
  getParticleCount,
  getParticleRenderState,
  type Particle,
} from "./loginParticleRing";

interface LoginParticleCircleProps {
  className?: string;
  densityScale?: number;
  motionScale?: number;
  thicknessScale?: number;
}

const cssColorNames = ["--primary", "--ncg-cyan", "--ncg-navy", "--foreground", "--card"];
const fallbackColors = ["#1D2C5B", "#00AEEF", "#1D2C5B", "#0F172A", "#FFFFFF"];
const twoPi = Math.PI * 2;
const thicknessEase = 0.045;
const tabletViewportMaxWidth = 1180;
const tabletDensityScale = 0.5;

function resolveCssColor(name: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${name}, ${fallback})`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();

  return resolved ? resolved : fallback;
}

function readParticlePalette(): string[] {
  return cssColorNames.map((name, index) => resolveCssColor(name, fallbackColors[index] ?? "#00AEEF"));
}

function getResponsiveDensityScale(): number {
  return window.innerWidth <= tabletViewportMaxWidth ? tabletDensityScale : 1;
}

export function LoginParticleCircle({
  className,
  densityScale = 1,
  motionScale = 0,
  thicknessScale = 1,
}: LoginParticleCircleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentMotionScaleRef = useRef(motionScale);
  const currentThicknessScaleRef = useRef(thicknessScale);
  const targetMotionScaleRef = useRef(motionScale);
  const targetThicknessScaleRef = useRef(thicknessScale);

  useEffect(() => {
    targetThicknessScaleRef.current = thicknessScale;
  }, [thicknessScale]);

  useEffect(() => {
    targetMotionScaleRef.current = motionScale;
  }, [motionScale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    let animationFrame = 0;
    let currentSize = 0;
    let responsiveDensityScale = getResponsiveDensityScale();
    let devicePixelRatio = 1;
    let particles: Particle[] = [];
    let palette = readParticlePalette();
    let pointerPhase = 0;
    const motionQuery = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    let reducedMotion = Boolean(motionQuery?.matches);

    const draw = (time: number) => {
      if (currentSize === 0) {
        return;
      }

      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      context.clearRect(0, 0, currentSize, currentSize);
      context.globalCompositeOperation = "lighter";

      const pulseSpeed = reducedMotion ? 0 : time * 0.00055;
      const orbitOffset = reducedMotion ? 0 : time * 0.000065;
      const motionDelta = targetMotionScaleRef.current - currentMotionScaleRef.current;
      const thicknessDelta = targetThicknessScaleRef.current - currentThicknessScaleRef.current;

      if (reducedMotion || Math.abs(motionDelta) < 0.001) {
        currentMotionScaleRef.current = targetMotionScaleRef.current;
      } else {
        currentMotionScaleRef.current += motionDelta * thicknessEase;
      }

      if (reducedMotion || Math.abs(thicknessDelta) < 0.001) {
        currentThicknessScaleRef.current = targetThicknessScaleRef.current;
      } else {
        currentThicknessScaleRef.current += thicknessDelta * thicknessEase;
      }

      for (const particle of particles) {
        const renderState = getParticleRenderState(
          particle,
          currentSize,
          pulseSpeed,
          orbitOffset,
          pointerPhase,
          currentThicknessScaleRef.current,
          currentMotionScaleRef.current,
        );

        context.beginPath();
        context.globalAlpha = renderState.alpha;
        context.fillStyle = palette[particle.colorIndex] ?? palette[0] ?? "#00AEEF";
        context.arc(renderState.x, renderState.y, renderState.radius, 0, twoPi);
        context.fill();
      }

      context.globalAlpha = 1;

      if (!reducedMotion) {
        animationFrame = window.requestAnimationFrame(draw);
      }
    };

    const start = () => {
      window.cancelAnimationFrame(animationFrame);
      if (reducedMotion) {
        draw(0);
        return;
      }

      animationFrame = window.requestAnimationFrame(draw);
    };

    const syncCanvasSize = () => {
      const rect = canvas.parentElement?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
      const nextSize = Math.max(260, Math.floor(Math.min(rect.width || 520, rect.height || rect.width || 520)));
      const nextPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const nextResponsiveDensityScale = getResponsiveDensityScale();
      const needsResize =
        nextSize !== currentSize ||
        nextPixelRatio !== devicePixelRatio ||
        nextResponsiveDensityScale !== responsiveDensityScale;

      if (!needsResize) {
        return;
      }

      currentSize = nextSize;
      responsiveDensityScale = nextResponsiveDensityScale;
      devicePixelRatio = nextPixelRatio;
      canvas.width = Math.floor(currentSize * devicePixelRatio);
      canvas.height = Math.floor(currentSize * devicePixelRatio);
      canvas.style.width = `${currentSize}px`;
      canvas.style.height = `${currentSize}px`;
      particles = createParticles(
        Math.max(1, Math.round(getParticleCount(currentSize) * densityScale * responsiveDensityScale)),
        cssColorNames.length,
      );
      start();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerPhase = Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2);

      if (reducedMotion) {
        draw(performance.now());
      }
    };

    const handleThemeChange = () => {
      palette = readParticlePalette();

      if (reducedMotion) {
        draw(performance.now());
      }
    };

    const handleMotionChange = (event: MediaQueryListEvent) => {
      reducedMotion = event.matches;
      start();
    };

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncCanvasSize) : null;
    const themeObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(handleThemeChange) : null;

    resizeObserver?.observe(canvas.parentElement ?? canvas);
    themeObserver?.observe(document.documentElement, { attributeFilter: ["class", "style"], attributes: true });
    motionQuery?.addEventListener("change", handleMotionChange);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("resize", syncCanvasSize);

    syncCanvasSize();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      motionQuery?.removeEventListener("change", handleMotionChange);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("resize", syncCanvasSize);
    };
  }, [densityScale]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="login-particle-circle"
      className={cn("pointer-events-none h-full w-full", className)}
      style={{ filter: "drop-shadow(0 0 16px color-mix(in srgb, var(--primary) 42%, transparent))" }}
    />
  );
}
