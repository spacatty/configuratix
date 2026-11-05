"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { copyToClipboard } from "@/lib/clipboard";

export type TerminalConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

/** Agent-side state as reported by the backend over the socket. */
export type TerminalAgentStatus = "unknown" | "connected" | "waiting" | "reconnecting" | "disconnected";

interface WebSocketTerminalProps {
  machineId: string;
  apiUrl: string;
  token: string;
  isActive?: boolean; // Connect lazily the first time this becomes true
  /** Called whenever the browser <-> backend connection status changes. */
  onStatusChange?: (status: TerminalConnectionStatus, agent: TerminalAgentStatus) => void;
  /** Hide the built-in status bar (status is still reported via onStatusChange). */
  hideStatusBar?: boolean;
  className?: string;
}

/** Imperative controls (via ref) for toolbars wrapping the terminal. */
export interface WebSocketTerminalHandle {
  /** Clears the local screen and scrollback (does not send anything to the shell). */
  clear: () => void;
  /** Copies the current selection, or the whole buffer when nothing is selected. Resolves to the copied text ("" if nothing/failed). */
  copySelection: () => Promise<string>;
  focus: () => void;
  /** Drops the socket and reconnects (resets the backoff counter). */
  reconnect: () => void;
}

const PING_INTERVAL_MS = 25_000;
// The backend pings every 20s and answers JSON pings; silence this long means a dead socket.
const STALE_AFTER_MS = 65_000;
const BACKOFF_BASE_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;
const MAX_ATTEMPTS = 10;

const ANSI = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};

function backoffDelay(attempt: number) {
  const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2)); // jitter
}

export const WebSocketTerminal = forwardRef<WebSocketTerminalHandle, WebSocketTerminalProps>(function WebSocketTerminal(
  { machineId, apiUrl, token, isActive = true, onStatusChange, hideStatusBar = false, className },
  ref,
) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(false);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastMessageRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const agentStatusRef = useRef<TerminalAgentStatus>("unknown");
  const statusRef = useRef<TerminalConnectionStatus>("connecting");
  // connect() and scheduleReconnect() call each other; the cycle is broken through this ref.
  const scheduleReconnectRef = useRef<() => void>(() => {});
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  const [status, setStatus] = useState<TerminalConnectionStatus>("connecting");
  const [agentStatus, setAgentStatus] = useState<TerminalAgentStatus>("unknown");
  const [attempt, setAttempt] = useState(0);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const updateStatus = useCallback((next: TerminalConnectionStatus, agent?: TerminalAgentStatus) => {
    const agentNext = agent ?? agentStatusRef.current;
    if (statusRef.current === next && agentStatusRef.current === agentNext) return;
    statusRef.current = next;
    agentStatusRef.current = agentNext;
    setStatus(next);
    setAgentStatus(agentNext);
    onStatusChangeRef.current?.(next, agentNext);
  }, []);

  const send = useCallback((msg: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const sendResize = useCallback(() => {
    const term = termRef.current;
    if (term) send({ type: "resize", cols: term.cols, rows: term.rows });
  }, [send]);

  const fit = useCallback(() => {
    const el = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    // Hidden (display:none / inactive tab): fitting would collapse to 0 cols.
    if (!el || !fitAddon || el.clientWidth === 0 || el.clientHeight === 0) return;
    try {
      fitAddon.fit();
    } catch {
      // xterm not ready yet
    }
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
  }, []);

  const handleAgentStatus = useCallback(
    (code: string, sessionId?: string) => {
      const term = termRef.current;
      const prev = agentStatusRef.current;
      switch (code) {
        case "agent_connected":
        case "connected":
          if (prev !== "connected") term?.writeln(ANSI.green("● Agent connected"));
          if (sessionId) {
            if (sessionIdRef.current && sessionIdRef.current !== sessionId) {
              term?.writeln(ANSI.yellow("● Previous shell session is gone - this is a new shell"));
            }
            sessionIdRef.current = sessionId;
          }
          updateStatus(statusRef.current, "connected");
          break;
        case "agent_waiting":
        case "waiting":
          if (prev !== "waiting") term?.writeln(ANSI.yellow("● Waiting for agent to connect..."));
          updateStatus(statusRef.current, "waiting");
          break;
        case "agent_reconnecting":
          if (prev !== "reconnecting") term?.writeln(ANSI.yellow("\r\n● Agent connection lost, waiting for it to reconnect..."));
          updateStatus(statusRef.current, "reconnecting");
          break;
        case "agent_disconnected":
          if (prev !== "disconnected") term?.writeln(ANSI.red("\r\n● Agent disconnected"));
          updateStatus(statusRef.current, "disconnected");
          break;
        case "shell_started":
          if (sessionIdRef.current && sessionId && sessionIdRef.current !== sessionId) {
            term?.writeln(ANSI.yellow("\r\n● Previous shell session ended - started a new shell"));
          }
          if (sessionId) sessionIdRef.current = sessionId;
          // A fresh PTY starts at 80x24: push our size.
          sendResize();
          break;
        case "shell_resumed":
          if (sessionId) sessionIdRef.current = sessionId;
          sendResize();
          break;
        case "shell_exited":
          term?.writeln(ANSI.dim("\r\n[shell exited - press any key to start a new one]"));
          break;
      }
    },
    [sendResize, updateStatus],
  );

  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    clearTimers();
    closeSocket();

    const term = termRef.current;
    const isReconnect = attemptRef.current > 0 || sessionIdRef.current !== null;
    updateStatus(isReconnect ? "reconnecting" : "connecting");
    if (!isReconnect) term?.writeln(ANSI.green("● Connecting to machine..."));

    const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
    const wsUrl = apiUrl.replace(/^https?/, wsProtocol);
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${wsUrl}/api/machines/${machineId}/terminal?token=${encodeURIComponent(token)}`);
    } catch {
      scheduleReconnectRef.current();
      return;
    }
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current || wsRef.current !== ws) return;
      const wasReconnect = attemptRef.current > 0;
      attemptRef.current = 0;
      setAttempt(0);
      lastMessageRef.current = Date.now();
      updateStatus("connected");
      if (wasReconnect) term?.writeln(ANSI.green("\r\n● Reconnected"));
      fit();
      sendResize();

      pingTimerRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastMessageRef.current > STALE_AFTER_MS) {
          // Zombie socket (proxy dropped it silently): force a reconnect.
          ws.close();
          return;
        }
        ws.send(JSON.stringify({ type: "ping" }));
      }, PING_INTERVAL_MS);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current || wsRef.current !== ws) return;
      lastMessageRef.current = Date.now();
      let msg: { type?: string; data?: string; session_id?: string };
      try {
        msg = JSON.parse(event.data);
      } catch {
        termRef.current?.write(String(event.data));
        return;
      }
      switch (msg.type) {
        case "output":
          if (msg.data) termRef.current?.write(msg.data);
          break;
        case "error":
          termRef.current?.writeln(ANSI.red(`Error: ${msg.data ?? ""}`));
          break;
        case "status":
          handleAgentStatus(msg.data ?? "", msg.session_id);
          break;
        case "pong":
        default:
          break;
      }
    };

    ws.onerror = () => {
      // onclose follows and handles reconnection
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      if (pingTimerRef.current) {
        clearInterval(pingTimerRef.current);
        pingTimerRef.current = null;
      }
      if (!mountedRef.current) return;
      scheduleReconnectRef.current();
    };
  }, [apiUrl, machineId, token, clearTimers, closeSocket, fit, sendResize, handleAgentStatus, updateStatus]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;
    if (reconnectTimerRef.current) return;
    const n = attemptRef.current;
    if (n >= MAX_ATTEMPTS) {
      updateStatus("disconnected");
      termRef.current?.writeln(ANSI.red("\r\n● Disconnected - use Reconnect to try again"));
      return;
    }
    const delay = backoffDelay(n);
    attemptRef.current = n + 1;
    setAttempt(n + 1);
    updateStatus("reconnecting");
    if (n === 0) termRef.current?.writeln(ANSI.yellow("\r\n● Connection lost, reconnecting..."));
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      connect();
    }, delay);
  }, [connect, updateStatus]);

  // connect() needs scheduleReconnect and vice versa; break the cycle via a ref.
  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  const manualReconnect = useCallback(() => {
    attemptRef.current = 0;
    setAttempt(0);
    connect();
  }, [connect]);

  useImperativeHandle(
    ref,
    () => ({
      clear: () => {
        termRef.current?.clear();
        termRef.current?.focus();
      },
      copySelection: async () => {
        const term = termRef.current;
        if (!term) return "";
        let text = term.hasSelection() ? term.getSelection() : "";
        if (!text) {
          const buf = term.buffer.active;
          const lines: string[] = [];
          for (let i = 0; i < buf.length; i++) lines.push(buf.getLine(i)?.translateToString(true) ?? "");
          text = lines.join(String.fromCharCode(10)).trimEnd();
        }
        if (text && !(await copyToClipboard(text))) return "";
        return text;
      },
      focus: () => termRef.current?.focus(),
      reconnect: manualReconnect,
    }),
    [manualReconnect],
  );

  // Activate lazily: the first time isActive is true we create xterm + socket
  // and keep them for the component's lifetime (survives tab switches).
  useEffect(() => {
    if (isActive && !hasConnectedOnce) setHasConnectedOnce(true);
  }, [isActive, hasConnectedOnce]);

  useEffect(() => {
    if (!hasConnectedOnce || !terminalRef.current) return;
    mountedRef.current = true;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"Fira Code", "Cascadia Code", Menlo, monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#e0e0e0",
        cursor: "#22c55e",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#22c55e33",
        black: "#1a1a1a",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e0e0e0",
        brightBlack: "#404040",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(terminalRef.current);
    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const inputSub = term.onData((data) => send({ type: "input", data }));
    const resizeSub = term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));

    let resizeRaf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => fit());
    });
    observer.observe(terminalRef.current);
    const fitTimer = setTimeout(fit, 50);

    const onOnline = () => {
      if (statusRef.current !== "connected") {
        attemptRef.current = 0;
        connect();
      }
    };
    window.addEventListener("online", onOnline);

    // Small delay avoids React Strict Mode double-mount connecting twice.
    const connectTimer = setTimeout(() => connect(), 100);

    return () => {
      mountedRef.current = false;
      clearTimeout(connectTimer);
      clearTimeout(fitTimer);
      cancelAnimationFrame(resizeRaf);
      window.removeEventListener("online", onOnline);
      observer.disconnect();
      clearTimers();
      closeSocket();
      inputSub.dispose();
      resizeSub.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      sessionIdRef.current = null;
      attemptRef.current = 0;
      agentStatusRef.current = "unknown";
      statusRef.current = "connecting";
    };
    // connect/fit/send are stable for a given machine/url/token
  }, [hasConnectedOnce, connect, fit, send, clearTimers, closeSocket]);

  // Refit when the tab becomes visible again.
  useEffect(() => {
    if (isActive) {
      const t = setTimeout(fit, 50);
      return () => clearTimeout(t);
    }
  }, [isActive, fit]);

  if (!hasConnectedOnce) {
    return (
      <div
        className="relative h-full flex items-center justify-center rounded-lg"
        style={{ minHeight: "400px", backgroundColor: "#0a0a0a" }}
      >
        <div className="text-center text-muted-foreground">
          <p className="text-sm">Terminal will connect when you switch to this tab</p>
        </div>
      </div>
    );
  }

  const view = describeStatus(status, agentStatus, attempt);

  return (
    <div className={`relative flex h-full flex-col overflow-hidden rounded-lg border border-border ${className ?? ""}`}>
      <div
        ref={terminalRef}
        className="min-h-0 w-full flex-1 overflow-hidden p-4"
        style={{ minHeight: "400px", backgroundColor: "#0a0a0a" }}
      />
      {!hideStatusBar && (
        <div
          className="flex items-center justify-between gap-3 border-t border-border bg-card px-3 py-1.5 text-xs text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 font-medium ${view.tone}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full bg-current ${view.pulse ? "animate-pulse" : ""}`} />
              {view.label}
            </span>
            {view.detail && <span className="truncate">{view.detail}</span>}
          </div>
          {status === "disconnected" && (
            <button
              type="button"
              onClick={manualReconnect}
              className="rounded border border-border px-2 py-0.5 font-medium text-foreground hover:bg-muted"
            >
              Reconnect
            </button>
          )}
        </div>
      )}
    </div>
  );
});

function describeStatus(
  status: TerminalConnectionStatus,
  agent: TerminalAgentStatus,
  attempt: number,
): { label: string; detail?: string; tone: string; pulse: boolean } {
  switch (status) {
    case "connecting":
      return { label: "Connecting", tone: "text-warning", pulse: true };
    case "reconnecting":
      return {
        label: "Reconnecting",
        detail: attempt > 0 ? `attempt ${attempt} of ${MAX_ATTEMPTS}` : undefined,
        tone: "text-warning",
        pulse: true,
      };
    case "disconnected":
      return { label: "Disconnected", tone: "text-destructive", pulse: false };
    case "connected":
      switch (agent) {
        case "waiting":
          return { label: "Connected", detail: "waiting for agent", tone: "text-warning", pulse: true };
        case "reconnecting":
          return { label: "Connected", detail: "agent reconnecting", tone: "text-warning", pulse: true };
        case "disconnected":
          return { label: "Connected", detail: "agent offline", tone: "text-destructive", pulse: false };
        default:
          return { label: "Connected", tone: "text-success", pulse: false };
      }
  }
}
