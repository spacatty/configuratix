"use client";

import * as React from "react";
import { toast } from "sonner";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Gauge, Globe, Network, Play, Radio, Server, Wifi, type LucideIcon } from "lucide-react";
import { api, type Job, type Machine, type SpeedTestRequest } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EmptyState,
  LogViewer,
  MachinePicker,
  RelativeTime,
  SectionCard,
  Spinner,
  StatusBadge,
  errorMessage,
  machineDisplayName,
  machineIp,
  openJobLogs,
} from "@/components/app";

type TestType = SpeedTestRequest["type"];

const TESTS: { type: TestType; title: string; desc: string; icon: LucideIcon; group: "Internet" | "Between machines" }[] = [
  { type: "public", title: "Speed test", desc: "speedtest-cli against the nearest Ookla server", icon: Globe, group: "Internet" },
  { type: "download", title: "Download", desc: "Fetch a test file from a URL", icon: ArrowDownToLine, group: "Internet" },
  { type: "upload", title: "Upload", desc: "Upload generated data", icon: ArrowUpFromLine, group: "Internet" },
  { type: "latency", title: "Latency", desc: "ping a machine or IP", icon: Wifi, group: "Internet" },
  { type: "network_info", title: "Network info", desc: "Interfaces, addresses, routes", icon: Network, group: "Internet" },
  { type: "iperf_server", title: "iPerf3 server", desc: "Listen for iPerf3 clients", icon: Radio, group: "Between machines" },
  { type: "iperf_client", title: "iPerf3 client", desc: "Measure bandwidth to a server", icon: Activity, group: "Between machines" },
  { type: "serve", title: "HTTP test server", desc: "Serve a file for downloads", icon: Server, group: "Between machines" },
  { type: "machine_download", title: "Machine download", desc: "Download from another machine's test server", icon: ArrowDownToLine, group: "Between machines" },
];

const NEEDS_TARGET: TestType[] = ["iperf_client", "latency", "machine_download"];

interface Metric {
  label: string;
  value: string;
  unit?: string;
}

/** Pulls headline numbers out of the agent's speed test output. */
function extractMetrics(type: TestType, logs: string): Metric[] {
  const out: Metric[] = [];
  const grab = (re: RegExp, label: string) => {
    const m = logs.match(re);
    if (m) out.push({ label, value: m[1], unit: m[2] });
  };
  if (type === "public") {
    grab(/Download:\s*([\d.]+)\s*(\w+\/s)/i, "Download");
    grab(/Upload:\s*([\d.]+)\s*(\w+\/s)/i, "Upload");
    grab(/(?:Ping|Latency):\s*([\d.]+)\s*(ms)/i, "Ping");
  } else if (type === "download" || type === "machine_download") {
    grab(/Download Speed:\s*([\d.]+)\s*([\w/]+)/i, "Download");
  } else if (type === "upload") {
    grab(/Upload Speed:\s*([\d.]+)\s*([\w/]+)/i, "Upload");
  } else if (type === "latency") {
    const m = logs.match(/=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/);
    if (m) {
      out.push({ label: "Min", value: m[1], unit: "ms" }, { label: "Avg", value: m[2], unit: "ms" }, { label: "Max", value: m[3], unit: "ms" });
    }
    grab(/([\d.]+)%\s*packet loss/i, "Loss");
    if (out.length && out[out.length - 1].label === "Loss") out[out.length - 1].unit = "%";
  } else if (type === "iperf_client") {
    const lines = logs.split("\n").filter((l) => /(sender|receiver)/.test(l));
    for (const l of lines) {
      const m = l.match(/([\d.]+)\s*([KMG]bits\/sec)/);
      if (m) out.push({ label: /sender/.test(l) ? "Sender" : "Receiver", value: m[1], unit: m[2] });
    }
  }
  return out;
}

interface Run {
  id: string;
  type: TestType;
  target?: string;
  job: Job | null;
  startedAt: string;
}

function NumField({ id, label, value, onChange, min, max, suffix }: { id: string; label: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix?: string }) {
  const invalid = Number.isNaN(value) || value < min || value > max;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          className={cn("font-data h-8", suffix && "pr-9")}
          value={Number.isNaN(value) ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value.replace(/[^\d]/g, "")))}
          aria-invalid={invalid}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted-foreground">{suffix}</span>}
      </div>
      {invalid && (
        <p className="text-[11px] text-destructive">
          {min}–{max}
        </p>
      )}
    </div>
  );
}

export function ToolsTab({ machine }: { machine: Machine }) {
  const [type, setType] = React.useState<TestType>("public");
  const [targetId, setTargetId] = React.useState<string | null>(null);
  const [targetMachine, setTargetMachine] = React.useState<Machine | null>(null);
  const [customIp, setCustomIp] = React.useState("");
  const [url, setUrl] = React.useState("https://speed.hetzner.de/100MB.bin");
  const [sizeMb, setSizeMb] = React.useState(100);
  const [uploadMb, setUploadMb] = React.useState(10);
  const [port, setPort] = React.useState(5201);
  const [servePort, setServePort] = React.useState(8765);
  const [duration, setDuration] = React.useState(10);
  const [serveDuration, setServeDuration] = React.useState(60);
  const [reverse, setReverse] = React.useState(false);
  const [count, setCount] = React.useState(10);

  const [runs, setRuns] = React.useState<Run[]>([]);
  const [current, setCurrent] = React.useState<string | null>(null);
  const run = runs.find((r) => r.id === current) ?? null;
  const running = !!run && (!run.job || run.job.status === "pending" || run.job.status === "running");

  // Poll the current job while it runs.
  React.useEffect(() => {
    if (!run || !running) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = await api.getJob(run.id);
        if (alive) setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, job: j } : r)));
      } catch {
        /* keep polling */
      }
    };
    const t = setInterval(tick, 1500);
    void tick();
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [run?.id, running]); // eslint-disable-line react-hooks/exhaustive-deps

  const meta = TESTS.find((t) => t.type === type)!;
  const needsTarget = NEEDS_TARGET.includes(type);
  const targetIp = (targetMachine ? machineIp(targetMachine) : customIp.trim()) ?? "";
  const ipValid = !customIp || /^[\d.]+$|^[0-9a-f:]+$|^[a-z0-9.-]+$/i.test(customIp.trim());

  const start = async () => {
    const req: SpeedTestRequest = { type };
    if (type === "download") req.url = url;
    if (type === "upload") req.size_mb = uploadMb;
    if (type === "iperf_server") Object.assign(req, { port, duration: serveDuration });
    if (type === "iperf_client") Object.assign(req, { target_ip: targetIp, port, duration, reverse });
    if (type === "latency") Object.assign(req, { target_ip: targetIp, count });
    if (type === "machine_download") Object.assign(req, { target_ip: targetIp, port: servePort, size_mb: sizeMb });
    if (type === "serve") Object.assign(req, { port: servePort, size_mb: sizeMb, duration: serveDuration });
    try {
      const job = await api.runSpeedTest(machine.id, req);
      const r: Run = { id: job.id, type, target: needsTarget ? (targetMachine ? machineDisplayName(targetMachine) : (targetIp ?? undefined)) : undefined, job, startedAt: new Date().toISOString() };
      setRuns((rs) => [r, ...rs].slice(0, 12));
      setCurrent(job.id);
    } catch (e) {
      toast.error(`Couldn't start ${meta.title.toLowerCase()}`, { description: errorMessage(e) });
    }
  };

  const groups = ["Internet", "Between machines"] as const;
  const metrics = run?.job?.logs ? extractMetrics(run.type, run.job.logs) : [];
  const runMeta = run ? TESTS.find((t) => t.type === run.type) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <SectionCard icon={Gauge} title="Network tools" description="Runs on this machine as a job">
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g} className="space-y-1.5">
                <div className="text-[11px] text-subtle-foreground">{g}</div>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup">
                  {TESTS.filter((t) => t.group === g).map((t) => {
                    const Icon = t.icon;
                    const sel = t.type === type;
                    return (
                      <button
                        key={t.type}
                        type="button"
                        role="radio"
                        aria-checked={sel}
                        onClick={() => setType(t.type)}
                        className={cn(
                          "flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors",
                          sel ? "border-primary/50 bg-primary/[0.07]" : "border-border hover:border-border-strong hover:bg-surface-2/50"
                        )}
                      >
                        <Icon className={cn("mt-0.5 size-3.5 shrink-0", sel ? "text-foreground" : "text-muted-foreground")} />
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium">{t.title}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title={meta.title}
          description={meta.desc}
          footer={
            <Button
              className="w-full"
              onClick={start}
              disabled={running || (needsTarget && (!targetIp || !ipValid))}
            >
              {running ? <Spinner /> : <Play />}
              {running ? "Running…" : `Run ${meta.title.toLowerCase()}`}
            </Button>
          }
        >
          <div className="space-y-3">
            {needsTarget && (
              <div className="space-y-1.5">
                <Label className="text-xs">Target machine</Label>
                <MachinePicker
                  value={targetId}
                  onValueChange={(id, m) => {
                    setTargetId(id);
                    setTargetMachine(m);
                    if (id) setCustomIp("");
                  }}
                  filter={(m) => m.id !== machine.id && !!machineIp(m)}
                  groupBy="status"
                  clearable
                  modal={false}
                  placeholder="Pick a machine…"
                />
                <div className="flex items-center gap-2 py-0.5 text-[11px] text-subtle-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or an address
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Input
                  className="font-data h-8"
                  placeholder="203.0.113.10"
                  value={customIp}
                  onChange={(e) => {
                    setCustomIp(e.target.value);
                    if (e.target.value) {
                      setTargetId(null);
                      setTargetMachine(null);
                    }
                  }}
                  aria-invalid={!ipValid}
                />
                {type === "iperf_client" && <p className="text-[11px] text-muted-foreground">The target needs an iPerf3 server running (start one from its Tools tab).</p>}
                {type === "machine_download" && <p className="text-[11px] text-muted-foreground">The target needs an HTTP test server running on the port below.</p>}
              </div>
            )}
            {type === "download" && (
              <div className="space-y-1.5">
                <Label htmlFor="dl-url" className="text-xs">
                  File URL
                </Label>
                <Input id="dl-url" className="font-data h-8" value={url} onChange={(e) => setUrl(e.target.value)} aria-invalid={!/^https?:\/\//.test(url)} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              {type === "upload" && <NumField id="up-mb" label="Size" value={uploadMb} onChange={setUploadMb} min={1} max={100} suffix="MB" />}
              {(type === "iperf_server" || type === "iperf_client") && <NumField id="iperf-port" label="Port" value={port} onChange={setPort} min={1} max={65535} />}
              {type === "iperf_client" && <NumField id="iperf-dur" label="Duration" value={duration} onChange={setDuration} min={1} max={120} suffix="s" />}
              {(type === "iperf_server" || type === "serve") && <NumField id="serve-dur" label="Keep running" value={serveDuration} onChange={setServeDuration} min={5} max={3600} suffix="s" />}
              {(type === "serve" || type === "machine_download") && <NumField id="serve-port" label="Port" value={servePort} onChange={setServePort} min={1024} max={65535} />}
              {(type === "serve" || type === "machine_download") && <NumField id="serve-mb" label="File size" value={sizeMb} onChange={setSizeMb} min={1} max={1000} suffix="MB" />}
              {type === "latency" && <NumField id="ping-count" label="Pings" value={count} onChange={setCount} min={1} max={100} />}
            </div>
            {type === "iperf_client" && (
              <div className="flex items-center justify-between">
                <Label htmlFor="iperf-rev" className="text-xs font-normal text-muted-foreground">
                  Reverse (measure download)
                </Label>
                <Switch id="iperf-rev" checked={reverse} onCheckedChange={setReverse} />
              </div>
            )}
            {(type === "serve" || type === "iperf_server") && (
              <p className="text-[11px] text-muted-foreground">
                Make sure the port is allowed in UFW (Security tab). Listening on <span className="font-data">{machineIp(machine) ?? "this machine"}</span>.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="min-w-0 space-y-4">
        <SectionCard
          icon={runMeta?.icon}
          title={run ? `${runMeta?.title ?? run.type}${run.target ? ` → ${run.target}` : ""}` : "Results"}
          actions={
            run ? (
              <div className="flex items-center gap-2">
                <StatusBadge status={run.job?.status ?? "pending"} />
                <Button variant="ghost" size="sm" onClick={() => openJobLogs(run.id)}>
                  Details
                </Button>
              </div>
            ) : undefined
          }
        >
          {!run ? (
            <EmptyState icon={Gauge} title="No test run yet" description="Pick a test on the left and run it — output streams here live." size="compact" bordered={false} />
          ) : (
            <div className="space-y-4">
              {metrics.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {metrics.map((m) => (
                    <div key={m.label} className="rounded-lg border border-border bg-background/40 px-3 py-2.5 animate-fade-in-up">
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                      <div className="mt-0.5 flex items-baseline gap-1">
                        <span className="font-data text-2xl font-medium tracking-tight">{m.value}</span>
                        {m.unit && <span className="font-data text-xs text-muted-foreground">{m.unit}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <LogViewer
                logs={run.job?.logs}
                live={running}
                title={<span className="font-data">{run.type}</span>}
                maxHeight="420px"
                emptyText={running ? "Waiting for the agent… public tests can take up to 2 minutes." : "No output."}
              />
            </div>
          )}
        </SectionCard>

        {runs.length > 1 && (
          <SectionCard title="This session" flush>
            <ul className="divide-y divide-border">
              {runs.map((r) => {
                const t = TESTS.find((x) => x.type === r.type);
                const Icon = t?.icon ?? Gauge;
                const m = r.job?.logs ? extractMetrics(r.type, r.job.logs) : [];
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setCurrent(r.id)}
                      className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-[13px] hover:bg-surface-2/50", r.id === current && "bg-surface-2/40")}
                    >
                      <Icon className="size-3.5 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">
                        {t?.title ?? r.type}
                        {r.target && <span className="text-muted-foreground"> → {r.target}</span>}
                      </span>
                      <span className="font-data hidden truncate text-xs text-muted-foreground sm:inline">
                        {m.map((x) => `${x.label} ${x.value}${x.unit ? ` ${x.unit}` : ""}`).join(" · ")}
                      </span>
                      <StatusBadge status={r.job?.status ?? "pending"} size="sm" />
                      <span className="w-14 text-right text-xs text-muted-foreground">
                        <RelativeTime date={r.startedAt} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
