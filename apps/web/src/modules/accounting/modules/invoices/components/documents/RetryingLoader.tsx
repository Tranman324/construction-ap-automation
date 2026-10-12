"use client";

import { useId, type CSSProperties } from "react";
import styles from "./RetryingLoader.module.css";

export const DEFAULT_RETRYING_LOADER_SIZE = 110;
export const MIN_RETRYING_LOADER_SIZE = 40;
export const MAX_RETRYING_LOADER_SIZE = 200;

export interface RetryingLoaderProps {
  size?: number;
}

export function normalizeRetryingLoaderSize(size?: number): number {
  return Math.min(MAX_RETRYING_LOADER_SIZE, Math.max(MIN_RETRYING_LOADER_SIZE, Math.round(size ?? DEFAULT_RETRYING_LOADER_SIZE)));
}

export function RetryingLoader({ size }: RetryingLoaderProps) {
  const instanceId = useId().replace(/:/g, "");
  const filterId = `retrying-loader-filter-${instanceId}`;
  const gradientId = `retrying-loader-gradient-${instanceId}`;
  const loaderSize = normalizeRetryingLoaderSize(size);
  const style = { "--retrying-loader-size": `${loaderSize}px` } as CSSProperties;

  return (
    <span className={styles.root} style={style} data-testid="retrying-loader" data-size={loaderSize} aria-hidden="true">
      <svg className={styles.definitions} aria-hidden="true">
        <defs>
          <filter id={filterId}>
            <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 20 -10" result="gel" />
            <feComposite in="SourceGraphic" in2="gel" operator="atop" />
          </filter>
        </defs>
      </svg>
      <svg className={styles.spinner} viewBox="0 0 200 200" role="presentation" style={{ filter: `url(#${filterId})` }}>
        <defs>
          <linearGradient id={gradientId} x1="40" y1="40" x2="160" y2="160" gradientUnits="userSpaceOnUse">
            <stop className={styles.start} offset="0" />
            <stop className={styles.end} offset="1" />
          </linearGradient>
        </defs>
        <path className={styles.arc} d="m164,100c0,-35.346 -28.654,-64 -64,-64s-64,28.654 -64,64 28.654,64 64,64 64,-26.215 64,-64c0,-37.785 -26.921,-64 -64,-64 -37.079,0 -65.267,26.923 -64,64 1.267,37.077 26.703,65.053 64,64 37.297,-1.053 64,-64 64,-64" stroke={`url(#${gradientId})`} />
        <circle className={styles.dashes} cx="100" cy="100" r="64" stroke={`url(#${gradientId})`} />
      </svg>
      <svg className={styles.shadow} viewBox="0 0 200 200" role="presentation">
        <path className={styles.arc} d="m164,100c0,-35.346 -28.654,-64 -64,-64s-64,28.654 -64,64 28.654,64 64,64 64,-26.215 64,-64c0,-37.785 -26.921,-64 -64,-64 -37.079,0 -65.267,26.923 -64,64 1.267,37.077 26.703,65.053 64,64 37.297,-1.053 64,-64 64,-64" stroke={`url(#${gradientId})`} />
        <circle className={styles.dashes} cx="100" cy="100" r="64" stroke={`url(#${gradientId})`} />
      </svg>
    </span>
  );
}
