"use client";

export const dynamic = "force-dynamic";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { BrandedLoader } from "@/components/app/shell";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    const checkStatus = async () => {
      try {
        const token = localStorage.getItem("auth_token");
        if (token) {
          try {
            await api.getMe();
            router.push("/machines");
            return;
          } catch {
            localStorage.removeItem("auth_token");
          }
        }
        const status = await api.checkSetup();
        router.push(status.needs_setup ? "/setup" : "/login");
      } catch {
        router.push("/login");
      }
    };
    checkStatus();
  }, [router]);

  return <BrandedLoader />;
}
