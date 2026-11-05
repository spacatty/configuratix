"use client";

import * as React from "react";
import { toast } from "sonner";
import { Copy, Eraser, Maximize2, Minimize2, PlugZap, TerminalSquare } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot, type StatusTone } from "@/components/app";
// xterm touches `window` at import time: this module must be loaded with next/dynamic({ ssr: false }).
import { WebSocketTerminal, type TerminalAgentStatus, type TerminalConnectionStatus, type WebSocketTerminalHandle } from "@/components/terminal";

function describe(status: TerminalConnectionStatus | null, agent: TerminalAgentStatus): { label: string; detail?: string; tone: StatusTone; pulse: boolean } {
  switch (status) {
    case null:
      return { label: "Idle", tone: "muted", pulse: false };
    case "connecting":
      return { label: "Connecting", tone: "warning", pulse: true };
    case "reconnecting":
      return { label: "Reconnecting", tone: "warning", pulse: true };
    case "disconnected":
      return { label: "Disconnected", tone: "destructive", pulse: false };
    default:
      if (agent === "waiting") return { label: "Connected", detail: "waiting for agent", tone: "warning", pulse: true };
      if (agent === "reconnecting") return { label: "Connected", detail: "agent reconnecting", tone: "warning", pulse: true };
      if (agent === "disconnected") return { label: "Connected", detail: "agent offline", tone: "destructive", pulse: false };
      return { label: "Connected", detail: "PTY session", tone: "success", pulse: false };
  }
}

/** Full-height terminal panel with a toolbar around the (runtime-owned) WebSocketTerminal. */
export function TerminalTab({ machineId, machineName, active }: { machineId: string; machineName: string; active: boolean }) {
  const [session, setSession] = React.useState(0);
  const [status, setStatus] = React.useState<TerminalConnectionStatus | null>(null);
  const [agent, setAgent] = React.useState<TerminalAgentStatus>("unknown");
  const [fullscreen, setFullscreen] = React.useState(false);
  const termRef = React.useRef<WebSocketTerminalHandle>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") || "" : "";

  React.useEffect(() => {
    const t = setTimeout(() => termRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [fullscreen, active]);

  React.useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && e.shiftKey) setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen]);

  const clear = () => termRef.current?.clear();

  const copy = async () => {
    const text = (await termRef.current?.copySelection()) ?? "";
    if (text) toast.success("Copied", { description: `${text.split(String.fromCharCode(10)).length} lines` });
    else toast.info("Nothing to copy");
  };

  const view = describe(status, agent);

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-border bg-card",
        fullscreen ? "fixed inset-0 z-50 rounded-none border-0" : "h-[max(480px,calc(100svh-300px))]"
      )}
    >
      <div className="flex items-center gap-3 border-b border-border px-3 py-1.5">
        <TerminalSquare className="size-4 text-muted-foreground" />
        <span className="text-[13px] font-medium">{machineName}</span>
        <span className="inline-flex items-center gap-1.5 text-xs">
          <StatusDot tone={view.tone} pulse={view.pulse} />
          <span className="text-foreground">{view.label}</span>
          {view.detail && <span className="text-muted-foreground">· {view.detail}</span>}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={clear} disabled={!status} aria-label="Clear">
                <Eraser />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Clear scrollback (shell: <Kbd>Ctrl</Kbd>+<Kbd>L</Kbd>)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={copy} disabled={!status} aria-label="Copy">
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy selection (or whole buffer)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => termRef.current?.reconnect()}
                onDoubleClick={() => setSession((s) => s + 1)}
                aria-label="Reconnect"
              >
                <PlugZap />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reconnect (double-click for a fresh terminal)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
                {fullscreen ? <Minimize2 /> : <Maximize2 />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{fullscreen ? "Exit fullscreen (Shift+Esc)" : "Fullscreen"}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-background p-1.5 [&>div]:h-full">
        <WebSocketTerminal
          key={session}
          ref={termRef}
          machineId={machineId}
          apiUrl={api.getApiUrl()}
          token={token}
          isActive={active}
          hideStatusBar
          className="border-0"
          onStatusChange={(s, a) => {
            setStatus(s);
            setAgent(a);
          }}
        />
      </div>
    </div>
  );
}
