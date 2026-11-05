import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Inline callout. Always pair a tone with an icon as first child:
 * <Alert variant="warning"><TriangleAlert /><AlertTitle>..</AlertTitle><AlertDescription>..</AlertDescription></Alert>
 */
const alertVariants = cva(
  "relative w-full rounded-lg border px-3.5 py-3 text-[13px] grid has-[>svg]:grid-cols-[16px_1fr] grid-cols-[0_1fr] has-[>svg]:gap-x-3 gap-y-0.5 items-start [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current",
  {
    variants: {
      variant: {
        default: "bg-card border-border text-card-foreground [&>svg]:text-muted-foreground",
        info: "border-info/25 bg-info/[0.07] text-foreground [&>svg]:text-info",
        success: "border-success/25 bg-success/[0.07] text-foreground [&>svg]:text-success",
        warning: "border-warning/25 bg-warning/[0.07] text-foreground [&>svg]:text-warning",
        destructive: "border-destructive/30 bg-destructive/[0.08] text-foreground [&>svg]:text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 line-clamp-1 min-h-4 font-medium tracking-[-0.005em]", className)}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-muted-foreground col-start-2 grid justify-items-start gap-1 text-[13px] [&_p]:leading-relaxed",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("col-start-2 mt-2 flex flex-wrap gap-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
