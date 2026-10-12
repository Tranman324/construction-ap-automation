interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: string;
  rotation: number;
  rotationVelocity: number;
}

const CONFETTI_COLORS = ["#1D2C5B", "#00AEEF", "#10B981", "#F59E0B", "#6366F1"];
const CONFETTI_DURATION_MS = 2600;
const CONFETTI_PARTICLE_COUNT = 170;

export function shouldSuppressSpectrumSubmitConfetti(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function createParticle(width: number, height: number): ConfettiParticle {
  return {
    x: width / 2 + (Math.random() - 0.5) * 160,
    y: height * 0.42,
    vx: (Math.random() - 0.5) * 15,
    vy: Math.random() * -17 - 4,
    gravity: 0.34 + Math.random() * 0.22,
    size: 5 + Math.random() * 7,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)] ?? CONFETTI_COLORS[0],
    rotation: Math.random() * Math.PI,
    rotationVelocity: (Math.random() - 0.5) * 0.45,
  };
}

export function fireSpectrumSubmitConfetti(): boolean {
  if (shouldSuppressSpectrumSubmitConfetti() || typeof document === "undefined") {
    return false;
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) return false;

  const renderingContext = context;
  const width = window.innerWidth || document.documentElement.clientWidth || 1024;
  const height = window.innerHeight || document.documentElement.clientHeight || 768;
  const devicePixelRatio = window.devicePixelRatio || 1;
  const particles = Array.from(
    { length: CONFETTI_PARTICLE_COUNT },
    () => createParticle(width, height),
  );
  const start = performance.now();

  canvas.dataset.spectrumSubmitConfetti = "true";
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:99999";
  canvas.width = width * devicePixelRatio;
  canvas.height = height * devicePixelRatio;
  renderingContext.scale(devicePixelRatio, devicePixelRatio);
  document.body.appendChild(canvas);

  function drawFrame(timestamp: number) {
    const elapsed = timestamp - start;

    renderingContext.clearRect(0, 0, width, height);
    particles.forEach((particle) => {
      particle.vy += particle.gravity;
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vx *= 0.99;
      particle.rotation += particle.rotationVelocity;

      renderingContext.save();
      renderingContext.translate(particle.x, particle.y);
      renderingContext.rotate(particle.rotation);
      renderingContext.globalAlpha = Math.max(0, 1 - elapsed / CONFETTI_DURATION_MS);
      renderingContext.fillStyle = particle.color;
      renderingContext.fillRect(
        -particle.size / 2,
        -particle.size / 2,
        particle.size,
        particle.size * 0.62,
      );
      renderingContext.restore();
    });

    if (elapsed < CONFETTI_DURATION_MS) {
      window.requestAnimationFrame(drawFrame);
    } else {
      canvas.remove();
    }
  }

  window.requestAnimationFrame(drawFrame);
  return true;
}
