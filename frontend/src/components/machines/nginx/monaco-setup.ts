import type { Monaco } from "@monaco-editor/react";

export const CFX_THEME = "cfx-dark";

let registered = false;

/** Registers the Configuratix dark theme (mirrors globals.css tokens) and an nginx tokenizer. */
export function setupMonaco(monaco: Monaco) {
  if (registered) return;
  registered = true;

  monaco.editor.defineTheme(CFX_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: "e9e5e4" },
      { token: "comment", foreground: "77706f", fontStyle: "italic" },
      { token: "keyword", foreground: "f0b44a" },
      { token: "keyword.block", foreground: "ef6a5a", fontStyle: "bold" },
      { token: "variable", foreground: "7fb8f0" },
      { token: "string", foreground: "6fd3a0" },
      { token: "number", foreground: "d7a3f5" },
      { token: "regexp", foreground: "e8c67a" },
      { token: "delimiter", foreground: "9a9392" },
      { token: "key", foreground: "f0b44a" },
      { token: "type", foreground: "7fb8f0" },
    ],
    colors: {
      "editor.background": "#0f0d0d",
      "editor.foreground": "#ece8e7",
      "editorLineNumber.foreground": "#4a4544",
      "editorLineNumber.activeForeground": "#a39d9c",
      "editor.lineHighlightBackground": "#ffffff08",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#cf2f2e40",
      "editor.inactiveSelectionBackground": "#cf2f2e22",
      "editorCursor.foreground": "#ef4f45",
      "editorIndentGuide.background1": "#ffffff0d",
      "editorIndentGuide.activeBackground1": "#ffffff22",
      "editorWhitespace.foreground": "#ffffff14",
      "editorGutter.background": "#0f0d0d",
      "editorWidget.background": "#1a1717",
      "editorWidget.border": "#ffffff1f",
      "input.background": "#151313",
      "scrollbarSlider.background": "#ffffff14",
      "scrollbarSlider.hoverBackground": "#ffffff24",
      "scrollbarSlider.activeBackground": "#ffffff30",
      "diffEditor.insertedTextBackground": "#3fca8424",
      "diffEditor.removedTextBackground": "#f2643a26",
      "diffEditor.insertedLineBackground": "#3fca8414",
      "diffEditor.removedLineBackground": "#f2643a14",
      "diffEditorGutter.insertedLineBackground": "#3fca8426",
      "diffEditorGutter.removedLineBackground": "#f2643a26",
    },
  });

  if (!monaco.languages.getLanguages().some((l: { id: string }) => l.id === "nginx")) {
    monaco.languages.register({ id: "nginx", extensions: [".conf"], aliases: ["nginx"] });
    monaco.languages.setLanguageConfiguration("nginx", {
      comments: { lineComment: "#" },
      brackets: [["{", "}"]],
      autoClosingPairs: [
        { open: "{", close: "}" },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
      ],
      surroundingPairs: [
        { open: "{", close: "}" },
        { open: '"', close: '"' },
      ],
      indentationRules: { increaseIndentPattern: /{[^}]*$/, decreaseIndentPattern: /^\s*}/ },
    });
    monaco.languages.setMonarchTokensProvider("nginx", {
      blocks: ["http", "server", "location", "upstream", "events", "stream", "map", "geo", "if", "limit_except", "types", "split_clients", "mail"],
      tokenizer: {
        root: [
          [/#.*$/, "comment"],
          [/\$[A-Za-z_][\w]*/, "variable"],
          [/"([^"\\]|\\.)*"/, "string"],
          [/'([^'\\]|\\.)*'/, "string"],
          [/~\*?\s+\S+/, "regexp"],
          [
            /^(\s*)([a-z_][\w]*)/,
            [
              "",
              {
                cases: {
                  "@blocks": "keyword.block",
                  "@default": "keyword",
                },
              },
            ],
          ],
          [/\b\d+(\.\d+)*(k|m|g|s|ms|h|d|K|M|G)?\b/, "number"],
          [/[{};]/, "delimiter"],
          [/\b(on|off)\b/, "type"],
        ],
      },
    });
  }
}

export function languageForPath(path: string): string {
  const p = path.toLowerCase();
  if (p.startsWith("/etc/nginx/") || p.endsWith(".conf") || p.includes("nginx")) return "nginx";
  if (p.endsWith(".ini") || p.endsWith("www.conf") || p.includes("/etc/php/")) return "ini";
  if (p.endsWith(".json")) return "json";
  if (p.endsWith(".yaml") || p.endsWith(".yml")) return "yaml";
  if (p.endsWith(".sh") || p.endsWith("sshd_config") || p.includes("/etc/ssh/")) return "shell";
  if (p.endsWith(".xml")) return "xml";
  return "plaintext";
}

export const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 12.5,
  lineHeight: 19,
  fontFamily: 'var(--font-mono), "JetBrains Mono", "Fira Code", ui-monospace, monospace',
  fontLigatures: true,
  lineNumbers: "on" as const,
  scrollBeyondLastLine: false,
  wordWrap: "off" as const,
  renderWhitespace: "selection" as const,
  padding: { top: 10, bottom: 10 },
  automaticLayout: true,
  smoothScrolling: true,
  cursorBlinking: "smooth" as const,
  tabSize: 4,
  guides: { indentation: true, bracketPairs: false },
  stickyScroll: { enabled: true },
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
};
