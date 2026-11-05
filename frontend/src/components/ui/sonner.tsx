"use client"

import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

/**
 * Themed Toaster. Mounted once in (dashboard)/layout.tsx and (auth)/layout.tsx.
 * Use `toast.success / toast.error / toast.info / toast.warning / toast.promise`
 * from "sonner" anywhere. For jobs use `trackJob()` from "@/components/app".
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      gap={8}
      visibleToasts={5}
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-4 text-success" />,
        info: <Info className="size-4 text-info" />,
        warning: <TriangleAlert className="size-4 text-warning" />,
        error: <OctagonX className="size-4 text-destructive" />,
        loading: <LoaderCircle className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!bg-popover !text-popover-foreground !border !border-border-strong !rounded-lg !shadow-elevated !font-sans !text-[13px] !gap-2.5 !py-3 !px-3.5",
          title: "!font-medium !text-[13px] !leading-snug",
          description: "!text-muted-foreground !text-xs !leading-snug",
          actionButton:
            "!bg-surface-2 !text-foreground !border !border-border-strong !rounded-md !h-6 !px-2 !text-xs !font-medium hover:!bg-accent",
          cancelButton:
            "!bg-transparent !text-muted-foreground !rounded-md !h-6 !px-2 !text-xs hover:!text-foreground",
          closeButton:
            "!bg-popover !border-border-strong !text-muted-foreground hover:!text-foreground",
          icon: "!self-start !mt-px",
        },
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border-strong)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
