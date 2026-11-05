"use client";

import * as React from "react";
import { Download, Pause, Play, RefreshCw, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorState, LogViewer, RelativeTime, Spinner, StatusDot, usePolling } from "@/components/app";

const LOG_TYPES = [
  { value: "nginx_access", label: "nginx access" },
  { value: "nginx_error", label: "nginx error" },
  { value: "syslog", label: "syslog" },
  { value: "auth", label: "auth" },
  { value: "fail2ban", label: "fail2ban" },
];
const LINE_OPTIONS = ["100", "500", "1000", "2000"];

export function LogsTab({ machineId, machineName, active }: { machineId: string; machineName: string; active: boolean }) {
  const [type, setType] = React.useState("nginx_error");
  const [lines, setLines] = React.useState("500");
  const [live, setLive] = React.useState(true);
  const [query, setQuery] = React.useState("");

  // Polls only while the tab is visible and live mode is on; usePolling also pauses when the browser tab is hidden.
  const q = usePolling(() => api.getMachineLogs(machineId, type, Number(lines)), live ? 3000 : 0, {
    enabled: active,
    deps: [machineId, type, lines],
  });
  const raw = q.data?.logs ?? "";

  const filtered = React.useMemo(() => {
    const t = query.trim().toLowerCase();
    if (!t) return raw;
    return raw
      .split("\n")
      .filter((l) => l.toLowerCase().includes(t))
      .join("\n");
  }, [raw, query]);
  const matchCount = query.trim() ? (filtered ? filtered.split("\n").length : 0) : null;

  const download = () => {
    const blob = new Blob([raw], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${machineName}-${type}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" variant="outline" size="sm" value={type} onValueChange={(v) => v && setType(v)}>
          {LOG_TYPES.map((t) => (
            <ToggleGroupItem key={t.value} value={t.value} className="font-data text-[12px]">
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative w-full sm:w-60">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter lines…" className="h-7 pr-7 pl-8 text-[12.5px]" />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-1.5 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground" aria-label="Clear filter">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {matchCount !== null && <span className="font-data text-xs text-muted-foreground">{matchCount} matches</span>}
        <div className="ml-auto flex items-center gap-1.5">
          <Select value={lines} onValueChange={setLines}>
            <SelectTrigger size="sm" className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINE_OPTIONS.map((n) => (
                <SelectItem key={n} value={n}>
                  <span className="font-data">{n}</span> lines
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant={live ? "secondary" : "outline"} size="sm" onClick={() => setLive((l) => !l)}>
                {live ? <Pause /> : <Play />}
                {live ? "Live" : "Paused"}
                {live && <StatusDot status="running" size="xs" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{live ? "Refreshing every 3s — click to pause" : "Resume live tail"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => q.refresh()} aria-label="Refresh">
                {q.refreshing ? <Spinner /> : <RefreshCw />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Refresh now</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={download} disabled={!raw} aria-label="Download">
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Download .log</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {q.error && !q.data ? (
        <ErrorState error={q.error} onRetry={q.refresh} title="Couldn't read logs" />
      ) : (
        <LogViewer
          logs={filtered}
          live={live && active}
          title={<span className="font-data">{LOG_TYPES.find((t) => t.value === type)?.label ?? type}</span>}
          maxHeight="max(420px, calc(100svh - 330px))"
          emptyText={q.loading ? "Reading log from the agent…" : query ? "No lines match the filter." : "Log is empty."}
          actions={
            q.updatedAt ? (
              <span className="text-[11px] text-subtle-foreground">
                updated <RelativeTime date={new Date(q.updatedAt).toISOString()} />
              </span>
            ) : undefined
          }
        />
      )}
    </div>
  );
}
