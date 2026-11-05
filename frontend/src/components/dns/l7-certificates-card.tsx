"use client";

import * as React from "react";
import { RefreshCw, ScrollText, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { api, type L7CertificateStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  EmptyState,
  RelativeTime,
  SectionCard,
  Spinner,
  StatusBadge,
  errorMessage,
  openJobLogs,
  usePolling,
  useConfirm,
} from "@/components/app";
import { formatDate } from "@/lib/format";

import { trackJobsFrom } from "./dns-utils";

const CERT_TONE: Record<string, "success" | "warning" | "destructive" | "info" | "muted"> = {
  valid: "success",
  issued: "success",
  active: "success",
  pending: "muted",
  issuing: "info",
  expiring: "warning",
  expired: "destructive",
  failed: "destructive",
  error: "destructive",
};

function daysLeft(expires: string | null): number | null {
  if (!expires) return null;
  return Math.floor((new Date(expires).getTime() - Date.now()) / 86_400_000);
}

export function L7CertificatesCard({ domainId }: { domainId: string }) {
  const confirm = useConfirm();
  const q = usePolling(() => api.listDomainL7Certificates(domainId), 30000, { deps: [domainId] });
  const certs: L7CertificateStatus[] = q.data ?? [];
  const [issuing, setIssuing] = React.useState(false);

  const issue = async () => {
    const ok = await confirm({
      title: "Issue / renew certificates?",
      description: "Regenerates nginx on every Layer 7 pool machine and requests certificates where missing or near expiry.",
      confirmText: "Issue certificates",
    });
    if (!ok) return;
    setIssuing(true);
    try {
      const res = await api.issueDomainL7Certificates(domainId);
      trackJobsFrom(res, "Issue L7 certificates", () => void q.refresh());
      setTimeout(() => void q.refresh(), 2000);
    } catch (e) {
      toast.error("Couldn't queue issuance", { description: errorMessage(e) });
    } finally {
      setIssuing(false);
    }
  };

  return (
    <SectionCard
      title="Certificates"
      description="TLS certificates managed on Layer 7 proxy machines."
      icon={ShieldCheck}
      flush
      actions={
        <>
          <Button size="icon-sm" variant="ghost" aria-label="Refresh" onClick={() => void q.refresh()}>
            {q.refreshing ? <Spinner /> : <RefreshCw />}
          </Button>
          <Button size="sm" variant="outline" onClick={issue} disabled={issuing}>
            {issuing ? <Spinner /> : <ShieldCheck />}
            Issue / renew
          </Button>
        </>
      }
    >
      {certs.length === 0 ? (
        <EmptyState
          size="compact"
          bordered={false}
          icon={ShieldCheck}
          title={q.loading ? "Loading…" : "No certificates tracked yet"}
          description="Save a Layer 7 record with machines to start tracking certificates."
        />
      ) : (
        <ul className="divide-y divide-border">
          {certs.map((c) => {
            const d = daysLeft(c.expires_at);
            const tone = d !== null && d < 14 && c.status !== "expired" ? "warning" : (CERT_TONE[c.status] ?? "muted");
            return (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="font-data truncate text-[12.5px]">{c.domain}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {c.machine_name} <span className="font-data">{c.machine_ip}</span>
                    {c.issuer && <span className="ml-2 text-subtle-foreground">{c.issuer}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  {c.last_error ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <StatusBadge status={c.status} tone={tone} />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="font-data max-w-sm text-[11px] whitespace-pre-wrap">{c.last_error}</TooltipContent>
                    </Tooltip>
                  ) : (
                    <StatusBadge status={c.status} tone={tone} />
                  )}
                  <span className="font-data text-[11px] text-muted-foreground">
                    {c.expires_at ? `${formatDate(c.expires_at)}${d !== null ? ` · ${d}d` : ""}` : c.last_checked_at ? <RelativeTime date={c.last_checked_at} /> : "—"}
                  </span>
                </div>
                {c.last_job_id && (
                  <Button size="icon-sm" variant="ghost" aria-label="View job logs" onClick={() => openJobLogs(c.last_job_id!)}>
                    <ScrollText />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
