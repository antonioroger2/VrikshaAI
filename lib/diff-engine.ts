/**
 * diff-engine.ts — Unified diff generation +  application for in-place edits.
 * Uses the `diff` npm package (same algorithm as Git).
 */

import * as Diff from "diff";

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FilePatch {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  raw: string;
}

// ── Generate Diffs ────────────────────────────────────────────────────────────

/** Create a unified diff string between two versions of a file */
export function createUnifiedDiff(
  filePath: string,
  oldContent: string,
  newContent: string,
  contextLines = 3,
): string {
  return Diff.createTwoFilesPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: contextLines },
  );
}

/** Create a structured patch object */
export function createPatch(
  filePath: string,
  oldContent: string,
  newContent: string,
  contextLines = 3,
): FilePatch {
  const patches = Diff.structuredPatch(
    `a/${filePath}`,
    `b/${filePath}`,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: contextLines },
  );

  const hunks: DiffHunk[] = patches.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines,
  }));

  return {
    oldPath: `a/${filePath}`,
    newPath: `b/${filePath}`,
    hunks,
    raw: createUnifiedDiff(filePath, oldContent, newContent, contextLines),
  };
}

// ── Apply Diffs ───────────────────────────────────────────────────────────────

/** Apply a unified diff string to content. Returns the patched content or null if it fails. */
export function applyPatch(originalContent: string, patchText: string): string | null {
  const result = Diff.applyPatch(originalContent, patchText);
  if (result === false) return null;
  return result;
}

/** Apply a structured patch to file content */
export function applyStructuredPatch(
  originalContent: string,
  patch: FilePatch,
): string | null {
  const patchObj = {
    oldFileName: patch.oldPath,
    newFileName: patch.newPath,
    oldHeader: "",
    newHeader: "",
    hunks: patch.hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      lines: h.lines,
      linedelimiter: "\n",
    })),
  };

  const result = Diff.applyPatch(originalContent, patchObj);
  if (result === false) return null;
  return result;
}

// ── Diff Visualization ────────────────────────────────────────────────────────

export type DiffLineType = "add" | "remove" | "context" | "header";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

/** Parse a unified diff string into structured lines for rendering */
export function parseDiffLines(diffText: string): DiffLine[] {
  const lines = diffText.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // Parse hunk header
      const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
      result.push({ type: "header", content: line });
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      result.push({ type: "header", content: line });
    } else if (line.startsWith("+")) {
      result.push({
        type: "add",
        content: line.slice(1),
        newLineNumber: newLine++,
      });
    } else if (line.startsWith("-")) {
      result.push({
        type: "remove",
        content: line.slice(1),
        oldLineNumber: oldLine++,
      });
    } else if (line.startsWith(" ")) {
      result.push({
        type: "context",
        content: line.slice(1),
        oldLineNumber: oldLine++,
        newLineNumber: newLine++,
      });
    }
  }

  return result;
}

// ── Word-Level Diff ──────────────────────────────────────────────────────────

export interface WordChange {
  value: string;
  added?: boolean;
  removed?: boolean;
}

/** Get word-level changes between two strings (for inline highlighting) */
export function diffWords(oldStr: string, newStr: string): WordChange[] {
  return Diff.diffWords(oldStr, newStr);
}

/** Get character-level changes between two strings */
export function diffChars(oldStr: string, newStr: string): WordChange[] {
  return Diff.diffChars(oldStr, newStr);
}

// ── Patch Validation ──────────────────────────────────────────────────────────

/** Dry-run: check if a patch can be applied without actually modifying anything */
export function validatePatch(originalContent: string, patchText: string): boolean {
  const result = Diff.applyPatch(originalContent, patchText);
  return result !== false;
}

/** Count additions and removals in a diff */
export function diffStats(diffText: string): { additions: number; deletions: number } {
  const lines = parseDiffLines(diffText);
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.type === "add") additions++;
    if (line.type === "remove") deletions++;
  }
  return { additions, deletions };
}
