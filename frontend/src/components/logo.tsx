"use client";

import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  textClassName?: string;
}

const sizeMap = {
  sm: "h-6 w-6",
  md: "h-8 w-8",
  lg: "h-10 w-10",
  xl: "h-12 w-12",
};

const textSizeMap = {
  sm: "text-base",
  md: "text-lg",
  lg: "text-xl",
  xl: "text-2xl",
};

export function Logo({ className, size = "md", showText = true, textClassName }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div className={cn("relative", sizeMap[size])}>
        {/* Outer glow effect */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-red-500/30 to-orange-500/30 blur-md" />
        
        {/* Main logo container */}
        <svg
          viewBox="0 0 40 40"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={cn("relative", sizeMap[size])}
        >
          {/* Background with gradient */}
          <defs>
            <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ef4444" />
              <stop offset="50%" stopColor="#dc2626" />
              <stop offset="100%" stopColor="#b91c1c" />
            </linearGradient>
            <linearGradient id="accentGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#fca5a5" />
              <stop offset="100%" stopColor="#f87171" />
            </linearGradient>
            <linearGradient id="darkAccent" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#991b1b" />
              <stop offset="100%" stopColor="#7f1d1d" />
            </linearGradient>
          </defs>

          {/* Rounded square background */}
          <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#logoGradient)" />

          {/* Abstract "C" shape with configuration nodes */}
          {/* Main C arc */}
          <path
            d="M28 12C28 12 23 8 17 8C11 8 8 13 8 20C8 27 11 32 17 32C23 32 28 28 28 28"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />

          {/* Configuration nodes/dots */}
          <circle cx="28" cy="12" r="3" fill="white" />
          <circle cx="28" cy="28" r="3" fill="white" />
          
          {/* Center gear/settings indicator */}
          <circle cx="17" cy="20" r="4" fill="url(#accentGradient)" />
          <circle cx="17" cy="20" r="2" fill="url(#darkAccent)" />

          {/* Connection lines from center */}
          <line x1="21" y1="20" x2="25" y2="15" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
          <line x1="21" y1="20" x2="25" y2="25" stroke="white" strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />

          {/* Small accent dots */}
          <circle cx="25" cy="15" r="1.5" fill="white" opacity="0.8" />
          <circle cx="25" cy="25" r="1.5" fill="white" opacity="0.8" />
        </svg>
      </div>

      {showText && (
        <span className={cn(
          "font-bold tracking-tight bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text",
          textSizeMap[size],
          textClassName
        )}>
          Configuratix
        </span>
      )}
    </div>
  );
}

// Minimal version for favicon/small contexts
export function LogoMark({ className, size = "md" }: Omit<LogoProps, "showText" | "textClassName">) {
  return (
    <div className={cn("relative", sizeMap[size], className)}>
      <svg
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        <defs>
          <linearGradient id="logoGradientMark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="50%" stopColor="#dc2626" />
            <stop offset="100%" stopColor="#b91c1c" />
          </linearGradient>
        </defs>

        <rect x="2" y="2" width="36" height="36" rx="10" fill="url(#logoGradientMark)" />

        <path
          d="M28 12C28 12 23 8 17 8C11 8 8 13 8 20C8 27 11 32 17 32C23 32 28 28 28 28"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />

        <circle cx="28" cy="12" r="3" fill="white" />
        <circle cx="28" cy="28" r="3" fill="white" />
        <circle cx="17" cy="20" r="4" fill="white" fillOpacity="0.9" />
        <circle cx="17" cy="20" r="2" fill="#991b1b" />
      </svg>
    </div>
  );
}

