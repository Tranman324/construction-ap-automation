export interface Particle {
  alpha: number;
  angle: number;
  colorIndex: number;
  phase: number;
  radiusOffset: number;
  size: number;
  speed: number;
}

export interface ParticleRenderState {
  alpha: number;
  radius: number;
  x: number;
  y: number;
}

const twoPi = Math.PI * 2;

export function getParticleCount(size: number): number {
  if (size < 380) {
    return 1100;
  }

  return size < 560 ? 1650 : 2300;
}

export function createParticles(count: number, colorCount: number): Particle[] {
  return Array.from({ length: count }, (_, index) => ({
    alpha: 0.32 + Math.random() * 0.48,
    angle: (index / count) * twoPi,
    colorIndex: index % colorCount,
    phase: Math.random() * twoPi,
    radiusOffset: -1 + Math.random() * 2,
    size: 1.15 + Math.random() * 3.25,
    speed: 0.65 + Math.random() * 0.7,
  }));
}

export function getParticleRenderState(
  particle: Particle,
  currentSize: number,
  pulseSpeed: number,
  orbitOffset: number,
  pointerPhase: number,
  thicknessScale = 1,
  motionScale = 0,
): ParticleRenderState {
  const center = currentSize / 2;
  const ringRadius = currentSize * 0.385;
  const ringWidth = currentSize * 0.044 * thicknessScale;
  const shimmer = Math.sin(pulseSpeed + particle.phase + pointerPhase);
  const hoverWave = Math.sin(particle.angle * 6 - pulseSpeed * 3.2 + particle.phase);
  const angle = particle.angle + orbitOffset * particle.speed + hoverWave * 0.045 * motionScale;
  const radius = ringRadius
    + (particle.radiusOffset + shimmer * 0.45) * ringWidth
    + hoverWave * currentSize * 0.018 * motionScale;

  return {
    alpha: Math.min(0.98, particle.alpha * (0.72 + Math.abs(shimmer) * 0.34 + Math.abs(hoverWave) * 0.12 * motionScale)),
    radius: particle.size * (0.85 + Math.abs(shimmer) * 0.35 + Math.abs(hoverWave) * 0.22 * motionScale),
    x: Math.cos(angle) * radius + center,
    y: Math.sin(angle) * radius + center,
  };
}
