// The "T" mark — used standalone (e.g. favicon source).
// --logo-accent drives the crimson elements per theme.
// --logo-text drives the charcoal/white stem per theme.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 739.62 795.88"
      className={className}
      aria-hidden="true"
    >
      {/* Top bar — accent */}
      <path
        d="M68.25,62.71v119.5h606.47l-117.71-120.7s-488.17.3-488.76,1.2Z"
        fill="var(--logo-accent, #832419)"
      />
      {/* Left stem — text colour */}
      <path
        d="M235.26,308.75l-2.09,328.49,82.46,84.82v-425.3s-81.56,12.29-80.37,11.99Z"
        fill="var(--logo-text, #292828)"
      />
      {/* Right arm + inner vertical — accent */}
      <path
        d="M371.49,233.6h302.94v85.44h-174.17l1.2,319.07-128.46,117.11s-1.49-522.52-1.49-521.63Z"
        fill="var(--logo-accent, #832419)"
      />
      {/* Left arm bridge + notch cut — accent */}
      <polygon
        points="318.53 232.22 71.18 232.22 155.22 317.89 318.53 317.67 318.53 232.22"
        fill="var(--logo-accent, #832419)"
      />
    </svg>
  );
}
