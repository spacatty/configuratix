"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/app/confirm";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={150}>
      <ConfirmProvider>
        <div className="relative isolate flex min-h-svh flex-col overflow-hidden bg-background">
          {/* backdrop */}
          <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
            <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_40%,#000_20%,transparent_100%)]" />
            <div className="bg-noise absolute inset-0 opacity-[0.03] mix-blend-overlay" />
            <div className="absolute top-[18%] left-1/2 h-[380px] w-[620px] -translate-x-1/2 rounded-full bg-primary/[0.09] blur-[120px]" />
          </div>
          <main className="flex flex-1 items-center justify-center px-4 py-12">{children}</main>
          <footer className="flex items-center justify-center gap-2 pb-6 text-[11px] text-subtle-foreground">
            <span className="font-data">configuratix</span>
            <span aria-hidden>·</span>
            <span>proxy control plane</span>
          </footer>
        </div>
        <Toaster position="top-center" />
      </ConfirmProvider>
    </TooltipProvider>
  );
}
