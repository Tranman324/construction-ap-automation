"use client";

import { cn } from "@/modules/shared/lib/utils";

interface ToolboxMarkSignInProps {
  isActive?: boolean;
  onSignIn: () => void;
}

interface ToolboxMarkPathsProps {
  accentClassName: string;
  textClassName: string;
}

function ToolboxMarkPaths({ accentClassName, textClassName }: ToolboxMarkPathsProps) {
  return (
    <>
      <path
        d="M68.25,62.71v119.5h606.47l-117.71-120.7s-488.17.3-488.76,1.2Z"
        className={accentClassName}
      />
      <path
        d="M235.26,308.75l-2.09,328.49,82.46,84.82v-425.3s-81.56,12.29-80.37,11.99Z"
        className={textClassName}
      />
      <path
        d="M371.49,233.6h302.94v85.44h-174.17l1.2,319.07-128.46,117.11s-1.49-522.52-1.49-521.63Z"
        className={accentClassName}
      />
      <polygon
        points="315.62 233.25 68.27 233.25 152.31 318.92 315.62 318.69 315.62 233.25"
        className={accentClassName}
      />
    </>
  );
}

export function ToolboxMarkSignIn({ isActive = false, onSignIn }: ToolboxMarkSignInProps) {
  return (
    <button
      type="button"
      aria-label="Sign in to Toolbox"
      onClick={onSignIn}
      className="relative z-10 flex min-h-36 min-w-36 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-primary/20 sm:min-h-56 sm:min-w-56"
    >
      <span
        className={cn(
          "relative flex size-32 items-center justify-center transition-transform duration-500 ease-out sm:size-56 lg:size-60",
          isActive && "scale-105",
        )}
      >
        <span
          aria-hidden="true"
          data-testid="toolbox-mark-default"
          className={cn(
            "absolute inset-0 transition-opacity duration-500 ease-out",
            isActive && "opacity-0",
          )}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 739.62 795.88"
            aria-hidden="true"
            className="h-full w-full opacity-30 drop-shadow-sm dark:opacity-35"
          >
            <ToolboxMarkPaths
              accentClassName="fill-ncg-navy dark:fill-ncg-cyan"
              textClassName="fill-ncg-cyan dark:fill-white"
            />
          </svg>
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 739.62 795.88"
          aria-hidden="true"
          data-testid="toolbox-mark-hover"
          className={cn(
            "absolute inset-0 opacity-0 drop-shadow-sm transition-opacity duration-500 ease-out",
            isActive && "opacity-100",
          )}
        >
          <ToolboxMarkPaths
            accentClassName="fill-ncg-navy dark:fill-ncg-cyan"
            textClassName="fill-ncg-cyan dark:fill-white"
          />
        </svg>
      </span>
      <span
        className={cn(
          "mt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground/70 transition-colors duration-500 ease-out sm:mt-6 sm:text-xs sm:tracking-[0.24em]",
          isActive && "text-primary",
        )}
      >
        Click to sign in
      </span>
    </button>
  );
}
