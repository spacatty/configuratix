"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";

import { PageSkeleton } from "@/components/app";
import { DNSZoneView } from "@/components/dns/dns-zone-view";

export default function DNSZonePage() {
  const params = useParams<{ id: string }>();
  return (
    <Suspense fallback={<PageSkeleton stats={false} />}>
      <DNSZoneView id={params.id} />
    </Suspense>
  );
}
