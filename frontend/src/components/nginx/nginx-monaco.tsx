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
  // Colours are the app tokens from globals.css (oklch, hue 20) converted to hex:
  // card surface, warm neutrals for text, the red primary for block keywords and
  // the status hues (success / warning / info) for literals.
  monaco.editor.defineTheme("configuratix-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "c1bcbc" },
      { token: "comment", foreground: "797372", fontStyle: "italic" },
      { token: "keyword", foreground: "f07e79" },
      { token: "type", foreground: "f3efef" },
      { token: "variable", foreground: "84c3ef" },
      { token: "string", foreground: "88d1a2" },
      { token: "number", foreground: "f2c275" },
      { token: "delimiter", foreground: "8b8484" },
      { token: "delimiter.bracket", foreground: "8b8484" },
    ],
    colors: {
      "editor.background": "#100d0d",
      "editor.foreground": "#c1bcbc",
      "editorGutter.background": "#100d0d",
      "editorLineNumber.foreground": "#4a4444",
      "editorLineNumber.activeForeground": "#a09999",
      "editor.lineHighlightBackground": "#ffffff06",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#d62b3533",
      "editor.inactiveSelectionBackground": "#d62b351f",
      "editor.selectionHighlightBackground": "#ffffff0d",
      "editor.wordHighlightBackground": "#ffffff0d",
      "editorCursor.foreground": "#f07e79",
      "editorIndentGuide.background1": "#ffffff0a",
      "editorIndentGuide.activeBackground1": "#ffffff1a",
      "editorBracketMatch.background": "#ffffff10",
      "editorBracketMatch.border": "#00000000",
      "editorWhitespace.foreground": "#ffffff14",
      "editorWidget.background": "#151111",
      "editorWidget.border": "#ffffff1a",
      "input.background": "#100d0d",
      "input.border": "#ffffff1c",
      "focusBorder": "#d62b3580",
      "scrollbar.shadow": "#00000000",
      "scrollbarSlider.background": "#ffffff12",
      "scrollbarSlider.hoverBackground": "#ffffff1f",
      "scrollbarSlider.activeBackground": "#ffffff2a",
      "editorOverviewRuler.border": "#00000000",
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
        lineHeight: 20,
        fontFamily: "var(--font-mono), ui-monospace, monospace",
        fontLigatures: false,
        lineNumbers: "on",
        lineNumbersMinChars: 3,
        lineDecorationsWidth: 12,
        glyphMargin: false,
        folding: !readOnly,
        scrollBeyondLastLine: false,
        wordWrap: "on",
        wrappingIndent: "indent",
        padding: { top: 12, bottom: 12 },
        renderLineHighlight: readOnly ? "none" : "line",
        renderLineHighlightOnlyWhenFocus: true,
        occurrencesHighlight: readOnly ? "off" : "singleFile",
        selectionHighlight: !readOnly,
        matchBrackets: readOnly ? "never" : "always",
        guides: { indentation: true, highlightActiveIndentation: !readOnly },
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        contextmenu: !readOnly,
        automaticLayout: true,
        tabSize: 4,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
      }}
    />
  );
}
