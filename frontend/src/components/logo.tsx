"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  textClassName?: string;
  /** Soft brand glow behind the mark (auth screens / loader). */
  glow?: boolean;
}

const sizeMap = {
  xs: "size-5",
  sm: "size-6",
  md: "size-7",
  lg: "size-9",
  xl: "size-12",
};

const textSizeMap = {
  xs: "text-[13px]",
  sm: "text-sm",
  md: "text-[15px]",
  lg: "text-lg",
  xl: "text-2xl",
};

/** The Configuratix mark: a "C" arc routing to two config nodes. Flat brand red. */
function Mark({ className }: { className?: string }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <defs>
        <clipPath id={`${id}-c`}>
          <rect x="0" y="0" width="40" height="40" rx="10" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="40" height="40" fill="var(--primary)" />
        {/* top highlight */}
        <rect width="40" height="1.5" fill="white" fillOpacity="0.22" />
        <rect y="20" width="40" height="20" fill="black" fillOpacity="0.12" />
      </g>
      <path
        d="M28 12.5C25.8 10.3 22.6 9 19.2 9C13 9 9 13.8 9 20C9 26.2 13 31 19.2 31C22.6 31 25.8 29.7 28 27.5"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path d="M20.5 20H24.5L28 12.5M24.5 20L28 27.5" stroke="white" strokeOpacity="0.75" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="28" cy="12.5" r="2.75" fill="white" />
      <circle cx="28" cy="27.5" r="2.75" fill="white" />
      <circle cx="18.5" cy="20" r="3.25" fill="white" />
      <circle cx="18.5" cy="20" r="1.4" fill="var(--primary)" />
    </svg>
  );
}

export function Logo({ className, size = "md", showText = true, textClassName, glow }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className={cn("relative shrink-0", sizeMap[size])}>
        {glow && <div aria-hidden className="absolute -inset-2 rounded-2xl bg-primary/30 blur-xl" />}
        <Mark className={cn("relative", sizeMap[size])} />
      </div>
      {showText && (
        <span className={cn("font-semibold tracking-[-0.02em] text-foreground", textSizeMap[size], textClassName)}>
          Configuratix
        </span>
      )}
    </div>
  );
}

/** Mark only. */
export function LogoMark({ className, size = "md", glow }: Omit<LogoProps, "showText" | "textClassName">) {
  return (
    <div className={cn("relative shrink-0", sizeMap[size], className)}>
      {glow && <div aria-hidden className="absolute -inset-2 rounded-2xl bg-primary/30 blur-xl" />}
      <Mark className="relative size-full" />
    </div>
  );
}
