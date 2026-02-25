/**
 * CodeEditor — Monaco Editor wrapper with tab bar, language detection,
 * Ctrl+S save, and dirty-file indicators.
 */

"use client";

import { useCallback, useRef, useEffect } from "react";
import Editor, { type OnMount, type Monaco } from "@monaco-editor/react";
import { useRepoStore } from "@/store/repo-store";

// Vriksha dark theme for Monaco
const VRIKSHA_THEME = {
  base: "vs-dark" as const,
  inherit: true,
  rules: [
    { token: "comment", foreground: "8a9d8b", fontStyle: "italic" },
    { token: "keyword", foreground: "f5a623" },
    { token: "string", foreground: "a8e063" },
    { token: "number", foreground: "e8c547" },
    { token: "type", foreground: "8ec8e8" },
    { token: "function", foreground: "4caf50" },
    { token: "variable", foreground: "f5edd8" },
    { token: "operator", foreground: "c0533a" },
  ],
  colors: {
    "editor.background": "#0d1f0e",
    "editor.foreground": "#f5edd8",
    "editor.lineHighlightBackground": "#1a2e1a",
    "editor.selectionBackground": "#2d6a2f55",
    "editorCursor.foreground": "#a8e063",
    "editorLineNumber.foreground": "#5a6b5a",
    "editorLineNumber.activeForeground": "#a8e063",
    "editor.inactiveSelectionBackground": "#1d3a1f44",
    "editorIndentGuide.background": "#1d3a1f55",
    "editorIndentGuide.activeBackground": "#2d6a2f77",
    "editorBracketMatch.background": "#2d6a2f44",
    "editorBracketMatch.border": "#4caf50",
    "scrollbarSlider.background": "#2e1f0a55",
    "scrollbarSlider.hoverBackground": "#2e1f0a99",
  },
};

// Map our language strings to Monaco language IDs
function monacoLanguage(lang: string): string {
  const map: Record<string, string> = {
    typescript: "typescript",
    javascript: "javascript",
    python: "python",
    hcl: "hcl",
    json: "json",
    yaml: "yaml",
    markdown: "markdown",
    css: "css",
    html: "html",
    shell: "shell",
    rust: "rust",
    go: "go",
    java: "java",
    ruby: "ruby",
    dart: "dart",
    sql: "sql",
    toml: "toml",
    xml: "xml",
    dockerfile: "dockerfile",
    plaintext: "plaintext",
  };
  return map[lang] ?? "plaintext";
}

export default function CodeEditor() {
  const { activeFile, content, language, openTabs, updateContent, saveCurrentFile, openFile, closeTab } = useRepoStore();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  // Register theme on mount
  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    monaco.editor.defineTheme("vriksha-dark", VRIKSHA_THEME);
    monaco.editor.setTheme("vriksha-dark");

    // Ctrl+S / Cmd+S save
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveCurrentFile();
    });

    // Format on Shift+Alt+F
    editor.addCommand(
      monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
      () => {
        editor.getAction("editor.action.formatDocument")?.run();
      },
    );

    editor.focus();
  };

  // Focus editor when active file changes
  useEffect(() => {
    editorRef.current?.focus();
  }, [activeFile]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      updateContent(value ?? "");
    },
    [updateContent],
  );

  // Keyboard shortcut for closing tab (Ctrl+W)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "w") {
        e.preventDefault();
        if (activeFile) closeTab(activeFile);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeFile, closeTab]);

  return (
    <div className="code-editor-wrapper">
      {/* Tab bar */}
      <div className="editor-tabs">
        {openTabs.map((tab) => (
          <div
            key={tab.path}
            className={`editor-tab ${tab.path === activeFile ? "active" : ""}`}
            onClick={() => openFile(tab.path)}
          >
            <span className="editor-tab-name">
              {tab.dirty && <span className="editor-tab-dirty">●</span>}
              {tab.path.split("/").pop()}
            </span>
            <button
              className="editor-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.path);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Editor area */}
      {activeFile ? (
        <div className="editor-area">
          <div className="editor-breadcrumb">
            {activeFile.split("/").map((part, i, arr) => (
              <span key={i}>
                <span className={i === arr.length - 1 ? "breadcrumb-active" : "breadcrumb-dim"}>
                  {part}
                </span>
                {i < arr.length - 1 && <span className="breadcrumb-sep"> › </span>}
              </span>
            ))}
            <span className="breadcrumb-lang">{language}</span>
          </div>
          <Editor
            height="calc(100% - 60px)"
            language={monacoLanguage(language)}
            theme="vriksha-dark"
            value={content}
            onChange={handleChange}
            onMount={handleMount}
            loading={
              <div className="editor-loading">
                <div className="editor-loading-spinner" />
                <span>Loading editor…</span>
              </div>
            }
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              fontLigatures: true,
              minimap: { enabled: true, renderCharacters: false },
              wordWrap: "on",
              lineNumbers: "on",
              renderLineHighlight: "all",
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              cursorBlinking: "smooth",
              cursorSmoothCaretAnimation: "on",
              bracketPairColorization: { enabled: true },
              padding: { top: 8, bottom: 8 },
              tabSize: 2,
              automaticLayout: true,
              suggest: {
                showIcons: true,
                showStatusBar: true,
              },
            }}
          />
        </div>
      ) : (
        <div className="editor-empty">
          <div className="editor-empty-icon">🌿</div>
          <div className="editor-empty-title">VRIKSHA.ai Editor</div>
          <div className="editor-empty-sub">
            Open a file from the File Tree, or create a new one.
          </div>
          <div className="editor-empty-shortcuts">
            <div><kbd>Ctrl</kbd>+<kbd>S</kbd> Save</div>
            <div><kbd>Ctrl</kbd>+<kbd>W</kbd> Close tab</div>
            <div><kbd>Ctrl</kbd>+<kbd>P</kbd> Quick open</div>
          </div>
        </div>
      )}
    </div>
  );
}
