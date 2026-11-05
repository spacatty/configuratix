"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Table primitives. Density: header 36px, rows ~40px (cells py-2 px-3).
 * Numbers: add `className="text-right font-data"` on both TableHead and TableCell.
 * Pass `containerClassName` to control the scroll container (e.g. max-h + sticky header).
 */
function Table({
  className,
  containerClassName,
  containerStyle,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string; containerStyle?: React.CSSProperties }) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-auto", containerClassName)}
      style={containerStyle}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-[13px] border-separate border-spacing-0", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({
  className,
  sticky = false,
  ...props
}: React.ComponentProps<"thead"> & { sticky?: boolean }) {
  return (
    <thead
      data-slot="table-header"
      data-sticky={sticky || undefined}
      className={cn(
        "[&_th]:border-b [&_th]:border-border",
        sticky && "sticky top-0 z-10 [&_th]:bg-card",
        className
      )}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child_td]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "bg-muted/40 font-medium [&_td]:border-t [&_td]:border-border",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "group/row transition-colors [&>td]:border-b [&>td]:border-border/70 hover:bg-white/[0.025] data-[state=selected]:bg-primary/[0.07] data-[state=selected]:hover:bg-primary/10",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-muted-foreground h-9 px-3 text-left align-middle text-xs font-medium whitespace-nowrap first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0 [&:has([role=checkbox])]:w-9 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-10 px-3 py-2 align-middle whitespace-nowrap first:pl-4 last:pr-4 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("text-muted-foreground mt-4 text-sm", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
