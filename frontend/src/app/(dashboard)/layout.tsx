"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { api, type User } from "@/lib/api";
import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import {
  AppBackdrop,
  BrandedLoader,
  BreadcrumbLabelProvider,
  CommandPaletteProvider,
  CommandPaletteTrigger,
  ConfirmProvider,
  JobTrackerProvider,
  JobsIndicator,
  RouteBreadcrumbs,
} from "@/components/app";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      const token = api.getToken();
      if (!token) {
        router.push("/login");
        return;
      }
      try {
        const userData = await api.getMe();
        setUser(userData);
        setLoading(false);
      } catch {
        router.push("/login");
      }
    };
    checkAuth();
  }, [router]);

  const logout = useCallback(() => {
    api.logout();
    router.push("/login");
  }, [router]);

  if (loading) {
    return <BrandedLoader label="Verifying session" />;
  }

  return (
    <TooltipProvider delayDuration={150}>
      <ConfirmProvider>
        <JobTrackerProvider>
          <BreadcrumbLabelProvider>
            <CommandPaletteProvider role={user?.role} onLogout={logout}>
              <SidebarProvider>
                <AppSidebar user={user} onLogout={logout} />
                <SidebarInset className="isolate min-w-0 bg-transparent">
                  <AppBackdrop />
                  <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md supports-[backdrop-filter]:bg-background/65 md:px-4">
                    <SidebarTrigger className="-ml-1 text-muted-foreground hover:text-foreground" />
                    <Separator orientation="vertical" className="mr-1 h-4! bg-border-strong" />
                    <RouteBreadcrumbs className="flex-1" />
                    <div className="ml-auto flex items-center gap-1.5">
                      <CommandPaletteTrigger className="w-9 justify-center px-0 sm:w-auto sm:justify-start sm:px-2.5 lg:w-64" />
                      <JobsIndicator />
                    </div>
                  </header>
                  <div className="relative flex-1 overflow-x-hidden">
                    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6 lg:px-8">{children}</div>
                  </div>
                </SidebarInset>
              </SidebarProvider>
            </CommandPaletteProvider>
          </BreadcrumbLabelProvider>
        </JobTrackerProvider>
        <Toaster />
      </ConfirmProvider>
    </TooltipProvider>
  );
}
