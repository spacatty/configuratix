"use client"

import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const toggleVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-surface-2 data-[state=on]:text-foreground data-[state=on]:shadow-[inset_0_0_0_1px_var(--border-strong)] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 focus-visible:ring-[3px] focus-visible:ring-ring/30 outline-none transition-[color,box-shadow,background-color] whitespace-nowrap",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-input bg-card/60 hover:border-border-strong",
      },
      size: {
        default: "h-8 px-2.5 min-w-8",
        sm: "h-7 px-2 min-w-7 text-xs",
        lg: "h-9 px-3 min-w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
