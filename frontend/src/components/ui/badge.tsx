import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Badge — small inline label. Tinted variants are pale fill + same-hue text
 * + hairline border of the same hue. Use inside rows / next to values only.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-md border px-1.5 h-5 text-[11px] font-medium leading-none w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:border-destructive transition-[color,box-shadow,background-color] overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border-primary/35 bg-primary/15 text-[oklch(0.78_0.13_24)] [a&]:hover:bg-primary/25",
        solid:
          "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary:
          "border-border bg-secondary text-secondary-foreground [a&]:hover:bg-accent",
        destructive:
          "border-destructive/35 bg-destructive/12 text-destructive [a&]:hover:bg-destructive/20",
        outline:
          "border-border-strong text-foreground [a&]:hover:bg-accent",
        success:
          "border-success/30 bg-success/12 text-success [a&]:hover:bg-success/20",
        warning:
          "border-warning/30 bg-warning/12 text-warning [a&]:hover:bg-warning/20",
        info:
          "border-info/30 bg-info/12 text-info [a&]:hover:bg-info/20",
        muted:
          "border-border bg-muted text-muted-foreground [a&]:hover:text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
