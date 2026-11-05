"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { BeforeMount } from "@monaco-editor/react";

import { Skeleton } from "@/components/ui/skeleton";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-[200px] w-full rounded-none" />,
});

let registered = false;

/** Minimal nginx tokenizer + a theme matching the app surface. */
const beforeMount: BeforeMount = (monaco) => {
  if (registered) return;
  registered = true;
  monaco.languages.register({ id: "nginx" });
  monaco.languages.setMonarchTokensProvider("nginx", {
    tokenizer: {
      root: [
        [/#.*$/, "comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/\$[a-zA-Z_][\w]*/, "variable"],
        [/^\s*(location|server|map|upstream|if|http|stream|events)\b/, "keyword"],
        [/^\s*[a-z_][a-z0-9_]*/, "type"],
        [/\b\d+[kKmMgGsSdDhH]?\b/, "number"],
        [/[{}]/, "delimiter.bracket"],
        [/;/, "delimiter"],
      ],
    },
  });
  monaco.languages.setLanguageConfiguration("nginx", {
    comments: { lineComment: "#" },
    brackets: [["{", "}"]],
    autoClosingPairs: [
      { open: "{", close: "}" },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  });
  monaco.editor.defineTheme("configuratix-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6b7280", fontStyle: "italic" },
      { token: "keyword", foreground: "f0a07a" },
      { token: "type", foreground: "93c5fd" },
      { token: "variable", foreground: "c4b5fd" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "fcd34d" },
    ],
    colors: {
      "editor.background": "#0c0c0e",
      "editor.lineHighlightBackground": "#ffffff08",
      "editorLineNumber.foreground": "#4b5563",
      "editorGutter.background": "#0c0c0e",
    },
  });
};

export function NginxMonaco({
  value,
  onChange,
  readOnly,
  height = "100%",
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
  height?: string | number;
}) {
  return (
    <MonacoEditor
      height={height}
      language="nginx"
      theme="configuratix-dark"
      beforeMount={beforeMount}
      value={value}
      onChange={(v) => onChange?.(v ?? "")}
      options={{
        readOnly,
        domReadOnly: readOnly,
        minimap: { enabled: false },
        fontSize: 12.5,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        lineNumbers: "on",
        scrollBeyondLastLine: false,
        wordWrap: "on",
        padding: { top: 10, bottom: 10 },
        renderLineHighlight: readOnly ? "none" : "line",
        automaticLayout: true,
        tabSize: 4,
        folding: true,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}
