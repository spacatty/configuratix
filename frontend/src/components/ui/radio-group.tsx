"use client"

import * as React from "react"
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group"

import { cn } from "@/lib/utils"

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid gap-2.5", className)}
      {...props}
    />
  )
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "peer aspect-square size-4 shrink-0 rounded-full border border-border-strong bg-card/60 text-primary outline-none transition-[box-shadow,border-color] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=checked]:border-primary disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator
        data-slot="radio-group-indicator"
        className="relative flex items-center justify-center"
      >
        <span className="size-2 rounded-full bg-primary shadow-[0_0_8px_var(--primary-glow)]" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  )
}

/**
 * Card-style radio option: `<RadioCard value="x" title="..." description="..." />`
 * inside a <RadioGroup className="grid-cols-2">.
 */
function RadioCard({
  className,
  title,
  description,
  icon,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item> & {
  title: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-card"
      className={cn(
        "group relative flex items-start gap-3 rounded-lg border border-border bg-card/60 p-3 text-left outline-none transition-colors hover:border-border-strong focus-visible:ring-[3px] focus-visible:ring-ring/30 data-[state=checked]:border-primary/60 data-[state=checked]:bg-primary/[0.06] disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      {icon && <span className="mt-0.5 text-muted-foreground group-data-[state=checked]:text-primary [&_svg]:size-4">{icon}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13px] font-medium">{title}</span>
        {description && <span className="text-xs text-muted-foreground">{description}</span>}
      </span>
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-border-strong group-data-[state=checked]:border-primary">
        <RadioGroupPrimitive.Indicator>
          <span className="block size-2 rounded-full bg-primary" />
        </RadioGroupPrimitive.Indicator>
      </span>
    </RadioGroupPrimitive.Item>
  )
}

export { RadioGroup, RadioGroupItem, RadioCard }
