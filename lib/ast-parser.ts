/**
 * ast-parser.ts — Lightweight AST-like parser for code symbol extraction.
 *
 * Since tree-sitter requires WASM in the browser (heavy), we use a regex-based
 * approach that covers 90% of use cases for:
 *   - TypeScript/JavaScript functions, classes, interfaces
 *   - Python classes and functions
 *   - Terraform resource blocks
 *   - Go functions and structs
 *   - Rust functions and structs
 *
 * This enables the Agent to do targeted "surgical" edits on specific symbols
 * instead of rewriting entire files.
 */

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "resource"  // Terraform
  | "block"
  | "import"
  | "export"
  | "method";

export interface CodeSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number; // 1-indexed
  endLine: number;   // 1-indexed, inclusive
  indent: number;
  signature: string; // first line / declaration
  children?: CodeSymbol[];
}

export interface ExtractedChunk {
  symbol: CodeSymbol;
  code: string;           // The exact code block
  contextBefore: string;  // ±N lines before
  contextAfter: string;   // ±N lines after
  startLine: number;
  endLine: number;
}

// ── Symbol Extraction ─────────────────────────────────────────────────────────

/** Extract all top-level symbols from a file */
export function extractSymbols(content: string, language: string): CodeSymbol[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return extractTSSymbols(content);
    case "python":
      return extractPythonSymbols(content);
    case "hcl":
      return extractTerraformSymbols(content);
    case "go":
      return extractGoSymbols(content);
    case "rust":
      return extractRustSymbols(content);
    default:
      return extractGenericSymbols(content);
  }
}

// ── TypeScript / JavaScript ──────────────────────────────────────────────────

function extractTSSymbols(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  const patterns: Array<{ regex: RegExp; kind: SymbolKind }> = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function" },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/, kind: "function" },
    { regex: /^(?:export\s+)?class\s+(\w+)/, kind: "class" },
    { regex: /^(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
    { regex: /^(?:export\s+)?type\s+(\w+)/, kind: "type" },
    { regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+)?\s*=/, kind: "variable" },
    { regex: /^\s+(?:async\s+)?(\w+)\s*\(/, kind: "method" },
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    for (const { regex, kind } of patterns) {
      const match = trimmed.match(regex);
      if (match) {
        const endLine = findBlockEnd(lines, i, "{", "}");
        symbols.push({
          name: match[1],
          kind,
          startLine: i + 1,
          endLine: endLine + 1,
          indent,
          signature: trimmed.split("{")[0].trim(),
        });
        break;
      }
    }
  }

  return deduplicateSymbols(symbols);
}

// ── Python ───────────────────────────────────────────────────────────────────

function extractPythonSymbols(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    let match = trimmed.match(/^(?:async\s+)?def\s+(\w+)\s*\(/);
    if (match) {
      const endLine = findPythonBlockEnd(lines, i, indent);
      symbols.push({
        name: match[1],
        kind: "function",
        startLine: i + 1,
        endLine: endLine + 1,
        indent,
        signature: trimmed.split(":")[0].trim(),
      });
      continue;
    }

    match = trimmed.match(/^class\s+(\w+)/);
    if (match) {
      const endLine = findPythonBlockEnd(lines, i, indent);
      symbols.push({
        name: match[1],
        kind: "class",
        startLine: i + 1,
        endLine: endLine + 1,
        indent,
        signature: trimmed.split(":")[0].trim(),
      });
    }
  }

  return symbols;
}

// ── Terraform (HCL) ─────────────────────────────────────────────────────────

function extractTerraformSymbols(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    let match = trimmed.match(/^resource\s+"(\w+)"\s+"(\w+)"/);
    if (match) {
      const endLine = findBlockEnd(lines, i, "{", "}");
      symbols.push({
        name: `${match[1]}.${match[2]}`,
        kind: "resource",
        startLine: i + 1,
        endLine: endLine + 1,
        indent: 0,
        signature: trimmed.split("{")[0].trim(),
      });
      continue;
    }

    match = trimmed.match(/^(variable|output|data|locals|module|provider)\s+"?(\w+)"?/);
    if (match) {
      const endLine = findBlockEnd(lines, i, "{", "}");
      symbols.push({
        name: `${match[1]}.${match[2]}`,
        kind: "block",
        startLine: i + 1,
        endLine: endLine + 1,
        indent: 0,
        signature: trimmed.split("{")[0].trim(),
      });
    }
  }

  return symbols;
}

// ── Go ──────────────────────────────────────────────────────────────────────

function extractGoSymbols(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    let match = trimmed.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/);
    if (match) {
      const endLine = findBlockEnd(lines, i, "{", "}");
      symbols.push({
        name: match[1],
        kind: "function",
        startLine: i + 1,
        endLine: endLine + 1,
        indent: 0,
        signature: trimmed.split("{")[0].trim(),
      });
      continue;
    }

    match = trimmed.match(/^type\s+(\w+)\s+struct/);
    if (match) {
      const endLine = findBlockEnd(lines, i, "{", "}");
      symbols.push({
        name: match[1],
        kind: "class",
        startLine: i + 1,
        endLine: endLine + 1,
        indent: 0,
        signature: trimmed.split("{")[0].trim(),
      });
    }
  }

  return symbols;
}

// ── Rust ─────────────────────────────────────────────────────────────────────

function extractRustSymbols(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    let match = trimmed.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/);
    if (match) {
      const endLine = findBlockEnd(lines, i, "{", "}");
      symbols.push({
        name: match[1],
        kind: "function",
        startLine: i + 1,
        endLine: endLine + 1,
        indent: 0,
        signature: trimmed.split("{")[0].trim(),
      });
      continue;
    }

    match = trimmed.match(/^(?:pub\s+)?struct\s+(\w+)/);
    if (match) {
      const endLine = findBlockEnd(lines, i, "{", "}");
      symbols.push({
        name: match[1],
        kind: "class",
        startLine: i + 1,
        endLine: endLine + 1,
        indent: 0,
        signature: trimmed.split("{")[0].trim(),
      });
    }
  }

  return symbols;
}

// ── Generic fallback ─────────────────────────────────────────────────────────

function extractGenericSymbols(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const match = trimmed.match(/^(?:function|def|fn|func|class|struct|interface|type|resource)\s+(\w+)/);
    if (match) {
      const endLine = findBlockEnd(lines, i, "{", "}");
      symbols.push({
        name: match[1],
        kind: "function",
        startLine: i + 1,
        endLine: endLine + 1,
        indent: 0,
        signature: trimmed.split(/[{:]/)[0].trim(),
      });
    }
  }

  return symbols;
}

// ── Extract a specific symbol chunk with context ────────────────────────────

/** Extract a specific symbol by name, with ±contextLines surrounding context */
export function extractChunk(
  content: string,
  symbolName: string,
  language: string,
  contextLines = 5,
): ExtractedChunk | null {
  const symbols = extractSymbols(content, language);
  const symbol = symbols.find((s) => s.name === symbolName || s.name.includes(symbolName));
  if (!symbol) return null;

  const lines = content.split("\n");
  const startIdx = symbol.startLine - 1;
  const endIdx = symbol.endLine - 1;

  const ctxStartIdx = Math.max(0, startIdx - contextLines);
  const ctxEndIdx = Math.min(lines.length - 1, endIdx + contextLines);

  return {
    symbol,
    code: lines.slice(startIdx, endIdx + 1).join("\n"),
    contextBefore: lines.slice(ctxStartIdx, startIdx).join("\n"),
    contextAfter: lines.slice(endIdx + 1, ctxEndIdx + 1).join("\n"),
    startLine: symbol.startLine,
    endLine: symbol.endLine,
  };
}

/** Extract symbol at a specific line number */
export function extractSymbolAtLine(
  content: string,
  lineNumber: number,
  language: string,
): CodeSymbol | null {
  const symbols = extractSymbols(content, language);
  return (
    symbols.find((s) => lineNumber >= s.startLine && lineNumber <= s.endLine) ?? null
  );
}

// ── Import Graph ─────────────────────────────────────────────────────────────

export interface ImportInfo {
  source: string;     // the import path
  specifiers: string[]; // named imports
  isDefault: boolean;
  line: number;
}

/** Extract import statements from TS/JS */
export function extractImports(content: string): ImportInfo[] {
  const lines = content.split("\n");
  const imports: ImportInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // import { X, Y } from "path"
    let match = line.match(/^import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/);
    if (match) {
      imports.push({
        source: match[2],
        specifiers: match[1].split(",").map((s) => s.trim()).filter(Boolean),
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // import X from "path"
    match = line.match(/^import\s+(\w+)\s+from\s*["']([^"']+)["']/);
    if (match) {
      imports.push({
        source: match[2],
        specifiers: [match[1]],
        isDefault: true,
        line: i + 1,
      });
      continue;
    }

    // import * as X from "path"
    match = line.match(/^import\s*\*\s*as\s+(\w+)\s+from\s*["']([^"']+)["']/);
    if (match) {
      imports.push({
        source: match[2],
        specifiers: [match[1]],
        isDefault: false,
        line: i + 1,
      });
      continue;
    }

    // require("path")
    match = line.match(/(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/);
    if (match) {
      imports.push({
        source: match[2],
        specifiers: [match[1]],
        isDefault: true,
        line: i + 1,
      });
    }
  }

  return imports;
}

/** Build a dependency map: file → [files it imports] */
export function buildDependencyMap(
  fileContents: Map<string, string>,
): Map<string, string[]> {
  const depMap = new Map<string, string[]>();

  for (const [path, content] of fileContents) {
    const imports = extractImports(content);
    const deps = imports.map((i) => i.source).filter((s) => s.startsWith(".") || s.startsWith("@/"));
    depMap.set(path, deps);
  }

  return depMap;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Find matching closing brace for a block that starts on or after line `startIdx` */
function findBlockEnd(
  lines: string[],
  startIdx: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let found = false;

  for (let i = startIdx; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === open) {
        depth++;
        found = true;
      } else if (ch === close) {
        depth--;
        if (depth === 0 && found) return i;
      }
    }
  }

  return Math.min(startIdx + 50, lines.length - 1); // fallback
}

/** Find end of a Python block using indentation */
function findPythonBlockEnd(
  lines: string[],
  startIdx: number,
  baseIndent: number,
): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue; // skip blank lines
    const indent = line.length - line.trimStart().length;
    if (indent <= baseIndent) return i - 1;
  }
  return lines.length - 1;
}

/** Remove overlapping symbols (keep the outermost) */
function deduplicateSymbols(symbols: CodeSymbol[]): CodeSymbol[] {
  const sorted = symbols.sort((a, b) => a.startLine - b.startLine);
  const result: CodeSymbol[] = [];
  let lastEnd = -1;

  for (const sym of sorted) {
    // Skip inner symbols that are completely contained within a previous symbol
    // unless they are methods (which we want to keep as children)
    if (sym.startLine > lastEnd || sym.kind === "method") {
      result.push(sym);
      if (sym.endLine > lastEnd) lastEnd = sym.endLine;
    }
  }

  return result;
}
