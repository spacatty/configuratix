"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const indicatorVariants = cva("h-full w-full flex-1 rounded-full transition-transform duration-500 ease-out", {
  variants: {
    tone: {
      default: "bg-primary",
      success: "bg-success",
      warning: "bg-warning",
      destructive: "bg-destructive",
      info: "bg-info",
      muted: "bg-muted-foreground",
    },
  },
  defaultVariants: { tone: "default" },
})

/**
 * Progress bar. `tone="auto"` picks success/warning/destructive by thresholds
 * (>=90 destructive, >=75 warning, else success) — handy for CPU/RAM/disk.
 */
function Progress({
  className,
  indicatorClassName,
  value,
  tone = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  indicatorClassName?: string
  tone?: VariantProps<typeof indicatorVariants>["tone"] | "auto"
  size?: "sm" | "default"
}) {
  const v = Math.max(0, Math.min(100, value ?? 0))
  const resolved =
    tone === "auto" ? (v >= 90 ? "destructive" : v >= 75 ? "warning" : "success") : tone
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={v}
      className={cn(
        "relative w-full overflow-hidden rounded-full bg-white/[0.07]",
        size === "sm" ? "h-1" : "h-1.5",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(indicatorVariants({ tone: resolved }), indicatorClassName)}
        style={{ transform: `translateX(-${100 - v}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
