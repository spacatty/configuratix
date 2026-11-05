"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Copy, Eraser, Maximize2, Minimize2, PlugZap, TerminalSquare } from "lucide-react";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { StatusDot, type StatusTone } from "@/components/app";
import type { TerminalAgentStatus, TerminalConnectionStatus } from "@/components/terminal";

const WebSocketTerminal = dynamic(() => import("@/components/terminal").then((m) => m.WebSocketTerminal), {
  ssr: false,
  loading: () => <div className="skeleton-shimmer h-full w-full rounded-lg bg-background" />,
});

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
  const hostRef = React.useRef<HTMLDivElement>(null);
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") || "" : "";

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

  const textarea = () => hostRef.current?.querySelector<HTMLTextAreaElement>(".xterm-helper-textarea") ?? null;

  /** Sends Ctrl+L to the shell (clear screen) through xterm's own key handling. */
  const clear = () => {
    const ta = textarea();
    if (!ta) return;
    ta.focus();
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", keyCode: 76, ctrlKey: true, bubbles: true, cancelable: true }));
  };

  const copyScreen = async () => {
    const rows = hostRef.current?.querySelector<HTMLElement>(".xterm-rows");
    const text = rows?.innerText?.replace(/ /g, " ").replace(/[ \t]+$/gm, "").trim();
    if (!text) {
      toast.info("Nothing to copy", { description: "Select text in the terminal and press Ctrl+Shift+C instead." });
      return;
    }
    if (await copyToClipboard(text)) toast.success("Screen copied");
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
              <Button variant="ghost" size="icon-sm" onClick={clear} disabled={status !== "connected"} aria-label="Clear screen">
                <Eraser />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Clear screen <Kbd>Ctrl</Kbd>+<Kbd>L</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" onClick={copyScreen} disabled={!status} aria-label="Copy screen">
                <Copy />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy visible screen</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setStatus("connecting");
                  setSession((s) => s + 1);
                }}
                aria-label="New session"
              >
                <PlugZap />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Reconnect (new session)</TooltipContent>
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
      <div ref={hostRef} className="min-h-0 flex-1 bg-background p-1.5 [&>div]:h-full">
        <WebSocketTerminal
          key={session}
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
