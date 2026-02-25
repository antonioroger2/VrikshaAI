/**
 * DiffViewer — Rich diff rendering component with side-by-side or inline mode,
 * line numbers, and syntax highlighting for diff hunks.
 */

"use client";

import { useState, useMemo } from "react";
import { parseDiffLines, type DiffLine } from "@/lib/diff-engine";

interface DiffViewerProps {
  diffText: string;
  fileName?: string;
}

export default function DiffViewer({ diffText, fileName }: DiffViewerProps) {
  const [viewMode, setViewMode] = useState<"inline" | "split">("inline");
  const lines = useMemo(() => parseDiffLines(diffText), [diffText]);

  return (
    <div className="diff-viewer">
      <div className="diff-viewer-header">
        <div className="diff-viewer-file">
          <span className="diff-viewer-icon">📋</span>
          {fileName ?? "Diff Patch"}
        </div>
        <div className="diff-viewer-controls">
          <button
            className={`diff-mode-btn ${viewMode === "inline" ? "active" : ""}`}
            onClick={() => setViewMode("inline")}
          >
            Inline
          </button>
          <button
            className={`diff-mode-btn ${viewMode === "split" ? "active" : ""}`}
            onClick={() => setViewMode("split")}
          >
            Split
          </button>
        </div>
      </div>

      <div className="diff-viewer-body">
        {viewMode === "inline" ? (
          <InlineDiff lines={lines} />
        ) : (
          <SplitDiff lines={lines} />
        )}
      </div>
    </div>
  );
}

// ── Inline Diff ──────────────────────────────────────────────────────────────

function InlineDiff({ lines }: { lines: DiffLine[] }) {
  return (
    <div className="diff-inline">
      {lines.map((line, i) => (
        <div key={i} className={`diff-line-row diff-${line.type}`}>
          <span className="diff-gutter">
            {line.type === "header"
              ? ""
              : line.type === "remove"
              ? (line.oldLineNumber ?? "")
              : line.type === "add"
              ? ""
              : (line.oldLineNumber ?? "")}
          </span>
          <span className="diff-gutter">
            {line.type === "header"
              ? ""
              : line.type === "remove"
              ? ""
              : line.type === "add"
              ? (line.newLineNumber ?? "")
              : (line.newLineNumber ?? "")}
          </span>
          <span className="diff-sign">
            {line.type === "add" ? "+" : line.type === "remove" ? "−" : line.type === "header" ? "@@" : " "}
          </span>
          <span className="diff-content">{line.content}</span>
        </div>
      ))}
    </div>
  );
}

// ── Split Diff ───────────────────────────────────────────────────────────────

function SplitDiff({ lines }: { lines: DiffLine[] }) {
  // Build left (old) and right (new) columns
  const left: (DiffLine | null)[] = [];
  const right: (DiffLine | null)[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.type === "header") {
      left.push(line);
      right.push(line);
      i++;
    } else if (line.type === "context") {
      left.push(line);
      right.push(line);
      i++;
    } else if (line.type === "remove") {
      // Collect consecutive removes
      const removes: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "remove") {
        removes.push(lines[i]);
        i++;
      }
      // Collect consecutive adds
      const adds: DiffLine[] = [];
      while (i < lines.length && lines[i].type === "add") {
        adds.push(lines[i]);
        i++;
      }
      // Pair them up
      const maxLen = Math.max(removes.length, adds.length);
      for (let j = 0; j < maxLen; j++) {
        left.push(j < removes.length ? removes[j] : null);
        right.push(j < adds.length ? adds[j] : null);
      }
    } else if (line.type === "add") {
      left.push(null);
      right.push(line);
      i++;
    } else {
      i++;
    }
  }

  return (
    <div className="diff-split">
      <div className="diff-split-pane">
        {left.map((line, idx) => (
          <div key={idx} className={`diff-line-row diff-${line?.type ?? "empty"}`}>
            <span className="diff-gutter">{line?.oldLineNumber ?? ""}</span>
            <span className="diff-sign">
              {line?.type === "remove" ? "−" : line?.type === "header" ? "@@" : " "}
            </span>
            <span className="diff-content">{line?.content ?? ""}</span>
          </div>
        ))}
      </div>
      <div className="diff-split-divider" />
      <div className="diff-split-pane">
        {right.map((line, idx) => (
          <div key={idx} className={`diff-line-row diff-${line?.type ?? "empty"}`}>
            <span className="diff-gutter">{line?.newLineNumber ?? ""}</span>
            <span className="diff-sign">
              {line?.type === "add" ? "+" : line?.type === "header" ? "@@" : " "}
            </span>
            <span className="diff-content">{line?.content ?? ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
