"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

interface WebSocketTerminalProps {
  machineId: string;
  apiUrl: string;
  token: string;
  isActive?: boolean; // Only connect when this is true
}

export function WebSocketTerminal({ machineId, apiUrl, token, isActive = true }: WebSocketTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasConnectedOnce, setHasConnectedOnce] = useState(false);

  const connect = useCallback(() => {
    if (!terminalRef.current || !mountedRef.current) return;

    // Clean up existing terminal/websocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (termRef.current) {
      termRef.current.dispose();
      termRef.current = null;
    }

    // Create terminal
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
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(terminalRef.current);
    
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      if (mountedRef.current) {
        fitAddon.fit();
      }
    }, 50);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    term.writeln("\x1b[32m● Connecting to machine...\x1b[0m");

    // Connect WebSocket
    const wsProtocol = apiUrl.startsWith("https") ? "wss" : "ws";
    const wsUrl = apiUrl.replace(/^https?/, wsProtocol);
    const ws = new WebSocket(`${wsUrl}/api/machines/${machineId}/terminal?token=${token}`);

    // Keepalive ping interval
    let pingInterval: NodeJS.Timeout | null = null;

    ws.onopen = () => {
      if (!mountedRef.current) {
        ws.close();
        return;
      }
      setConnected(true);
      setError(null);
      term.writeln("\x1b[32m● Connected!\x1b[0m");
      term.writeln("");

      // Send terminal size
      ws.send(JSON.stringify({
        type: "resize",
        cols: term.cols,
        rows: term.rows,
      }));

      // Start keepalive ping - every 10 seconds to prevent agent timeout
      pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, 10000);
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "output") {
          term.write(msg.data);
        } else if (msg.type === "error") {
          term.writeln(`\x1b[31mError: ${msg.data}\x1b[0m`);
        } else if (msg.type === "status") {
          if (msg.data === "waiting") {
            term.writeln("\x1b[33m● Waiting for agent to connect...\x1b[0m");
          } else if (msg.data === "connected") {
            term.writeln("\x1b[32m● Agent connected!\x1b[0m");
            term.writeln("");
          }
        }
      } catch {
        // Raw output
        term.write(event.data);
      }
    };

    ws.onerror = () => {
      if (!mountedRef.current) return;
      setError("WebSocket connection failed");
      term.writeln("\x1b[31m● Connection error\x1b[0m");
    };

    ws.onclose = (event) => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (!mountedRef.current) return;
      setConnected(false);
      if (event.wasClean) {
        term.writeln("");
        term.writeln("\x1b[31m● Disconnected\x1b[0m");
      }
    };

    wsRef.current = ws;

    // Handle input
    const inputHandler = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "input",
          data: data,
        }));
      }
    });

    // Handle resize
    const handleResize = () => {
      if (!mountedRef.current) return;
      fitAddon.fit();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }));
      }
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      inputHandler.dispose();
    };
  }, [machineId, apiUrl, token]);

  useEffect(() => {
    mountedRef.current = true;
    
    // Only connect when isActive is true (tab is visible)
    if (!isActive) {
      return;
    }

    // Small delay to avoid React Strict Mode double-mount issues
    const timeoutId = setTimeout(() => {
      if (mountedRef.current && isActive) {
        setHasConnectedOnce(true);
        connect();
      }
    }, 100);

    return () => {
      mountedRef.current = false;
      clearTimeout(timeoutId);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
    };
  }, [connect, isActive]);

  // Show placeholder when not active and never connected
  if (!isActive && !hasConnectedOnce) {
    return (
      <div 
        className="relative h-full flex items-center justify-center"
        style={{ minHeight: "400px", backgroundColor: "#0a0a0a" }}
      >
        <div className="text-center text-muted-foreground">
          <p className="text-sm">Terminal will connect when you switch to this tab</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div 
        ref={terminalRef} 
        className="h-full w-full rounded-lg overflow-hidden p-4"
        style={{ minHeight: "400px", backgroundColor: "#0a0a0a" }}
      />
      {error && (
        <div className="absolute top-2 right-2 bg-red-500/20 text-red-400 px-3 py-1 rounded text-sm">
          {error}
        </div>
      )}
      <div className="absolute bottom-2 right-2 flex items-center gap-2 text-xs">
        <div className={`w-2 h-2 rounded-full ${connected ? "bg-green-500" : "bg-red-500"}`} />
        <span className="text-muted-foreground">
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>
    </div>
  );
}
