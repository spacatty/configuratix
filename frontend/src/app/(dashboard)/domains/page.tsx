"use client";

import { Suspense } from "react";

import { PageSkeleton } from "@/components/app";
import { DomainsView } from "@/components/domains/domains-view";

export default function DomainsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DomainsView />
    </Suspense>
  );
}
