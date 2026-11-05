"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { ListChecks } from "lucide-react";

import { jobTitle } from "@/lib/jobs";
import { CopyButton, PageHeader, StatusBadge, trackJob, useBreadcrumbLabel } from "@/components/app";
import { JobActionButtons, JobDetailBody, JobHeaderMeta, useJobDetail } from "@/components/jobs/job-detail";

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const { job, error, loading, refresh } = useJobDetail(id, null, true);
  useBreadcrumbLabel(job ? jobTitle(job) : null);

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/jobs", label: "Jobs" }}
        icon={ListChecks}
        title={job ? jobTitle(job) : "Loading job…"}
        badge={
          job ? (
            <>
              <StatusBadge status={job.status} />
              <span className="font-data text-[11px] text-subtle-foreground">{id.slice(0, 8)}</span>
              <CopyButton value={id} label="Copy job ID" />
            </>
          ) : null
        }
        meta={<JobHeaderMeta job={job} />}
        actions={
          <JobActionButtons
            job={job}
            onChanged={() => void refresh()}
            onRetried={(created) => {
              void trackJob(created, { title: created.title ?? undefined });
              router.push(`/jobs/${created.id}`);
            }}
          />
        }
      />
      <JobDetailBody
        job={job}
        loading={loading}
        error={error}
        onRetry={refresh}
        paneHeight="calc(100vh - 360px)"
        onOpenJob={(jid) => router.push(`/jobs/${jid}`)}
      />
    </div>
  );
}
