import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "relative inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-[13px] font-medium tracking-[-0.005em] transition-[color,background-color,border-color,box-shadow,opacity] duration-150 select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35 focus-visible:border-ring aria-invalid:ring-destructive/25 aria-invalid:border-destructive active:translate-y-px",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/18%),0_1px_2px_0_oklch(0_0_0/40%)] hover:bg-primary/90 hover:shadow-[inset_0_1px_0_0_oklch(1_0_0/18%),0_0_0_1px_var(--primary-glow),0_0_18px_-4px_var(--primary-glow)]",
        destructive:
          "border border-destructive/35 bg-destructive/12 text-destructive hover:bg-destructive/20 hover:border-destructive/55 focus-visible:ring-destructive/30 focus-visible:border-destructive",
        "destructive-solid":
          "bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 focus-visible:ring-destructive/35",
        outline:
          "border border-input bg-card/60 text-foreground shadow-[0_1px_0_0_oklch(1_0_0/3%)_inset] hover:bg-accent hover:border-border-strong",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "h-auto! px-0! text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3 has-[>svg]:px-2.5",
        xs: "h-6 rounded-sm gap-1 px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-7 gap-1.5 px-2.5 text-xs has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 px-4 text-sm has-[>svg]:px-3.5",
        icon: "size-8",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
