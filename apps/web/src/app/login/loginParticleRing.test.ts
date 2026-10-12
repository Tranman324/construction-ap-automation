import { describe, expect, it } from "vitest";
import { createParticles, getParticleCount, getParticleRenderState, type Particle } from "./loginParticleRing";

describe("loginParticleRing", () => {
  it("scales particle count with the available canvas size", () => {
    expect(getParticleCount(320)).toBe(1100);
    expect(getParticleCount(480)).toBe(1650);
    expect(getParticleCount(640)).toBe(2300);
  });

  it("creates particles distributed around a full ring", () => {
    const particles = createParticles(20, 5);

    expect(particles).toHaveLength(20);
    expect(particles[0]?.angle).toBe(0);
    expect(particles[10]?.angle).toBeCloseTo(Math.PI);
  });

  it("maps a particle onto the circular path", () => {
    const particle: Particle = {
      alpha: 0.8,
      angle: 0,
      colorIndex: 0,
      phase: 0,
      radiusOffset: 0,
      size: 3,
      speed: 1,
    };

    const state = getParticleRenderState(particle, 600, 0, 0, 0);

    expect(state.x).toBeGreaterThan(300);
    expect(state.x).toBeLessThan(600);
    expect(state.y).toBe(300);
    expect(state.radius).toBeGreaterThan(0);
  });

  it("supports scaling the ring thickness independently from density", () => {
    const particle: Particle = {
      alpha: 0.8,
      angle: 0,
      colorIndex: 0,
      phase: Math.PI / 2,
      radiusOffset: 1,
      size: 3,
      speed: 1,
    };

    const narrowState = getParticleRenderState(particle, 600, 0, 0, 0, 0.5);
    const fullState = getParticleRenderState(particle, 600, 0, 0, 0, 1);

    expect(fullState.x).toBeGreaterThan(narrowState.x);
  });

  it("adds stylized motion offsets independently from ring thickness", () => {
    const particle: Particle = {
      alpha: 0.8,
      angle: Math.PI / 3,
      colorIndex: 0,
      phase: Math.PI / 4,
      radiusOffset: 0,
      size: 3,
      speed: 1,
    };

    const idleState = getParticleRenderState(particle, 600, 1, 0, 0, 0.45, 0);
    const hoverState = getParticleRenderState(particle, 600, 1, 0, 0, 0.45, 1);

    expect(hoverState.x).not.toBe(idleState.x);
    expect(hoverState.y).not.toBe(idleState.y);
  });
});
