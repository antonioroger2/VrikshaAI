/**
 * ast-parser.ts — True AST parser using web-tree-sitter with WASM grammars.
 *
 * Provides surgical code-symbol extraction for the Agent Builder pipeline:
 *   - TypeScript/JavaScript (tree-sitter)
 *   - Python             (tree-sitter)
 *   - Go                 (tree-sitter)
 *   - Rust               (tree-sitter)
 *   - HCL / Terraform    (regex fallback – no WASM grammar available)
 *
 * The public API (`extractSymbols`, `extractChunk`, …) is identical to the
 * previous regex-only implementation so every consumer keeps working.
 *
 * NOTE: web-tree-sitter is dynamically imported at runtime ONLY in the browser
 * to avoid bundling Node.js-specific references (fs, module) during SSR/build.
 */

// ── Minimal tree-sitter type shapes (avoids static import of web-tree-sitter) ─

interface TSPoint {
  row: number;
  column: number;
}

interface TSNode {
  type: string;
  text: string;
  startPosition: TSPoint;
  endPosition: TSPoint;
  startIndex: number;
  endIndex: number;
  childCount: number;
  children: TSNode[];
  child(index: number): TSNode | null;
  childForFieldName(fieldName: string): TSNode | null;
}

interface TSTree {
  rootNode: TSNode;
  delete(): void;
}

interface TSLanguage {
  // opaque handle
}

interface TSParser {
  setLanguage(lang: TSLanguage): void;
  parse(input: string): TSTree;
}

interface TSModule {
  init(opts: { locateFile: () => string }): Promise<void>;
  Language: {
    load(path: string): Promise<TSLanguage>;
  };
  new (): TSParser;
}

// ── Public Types ─────────────────────────────────────────────────────────────

export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "resource" // Terraform
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

// ── Tree-sitter Singleton ────────────────────────────────────────────────────

type TSSyntaxNode = TSNode;

/** Map of language id → loaded Language grammar */
const languageCache = new Map<string, TSLanguage>();
let parserInstance: TSParser | null = null;
let initPromise: Promise<void> | null = null;
let TreeSitter: TSModule | null = null;

/**
 * Mapping from our language identifiers to the WASM grammar file name
 * located at `/tree-sitter/<file>.wasm` (served via `public/`).
 */
const WASM_GRAMMAR_MAP: Record<string, string> = {
  typescript: "tree-sitter-typescript",
  javascript: "tree-sitter-javascript",
  python: "tree-sitter-python",
  go: "tree-sitter-go",
  rust: "tree-sitter-rust",
};

/** Languages that fall back to regex (no WASM available) */
const REGEX_ONLY_LANGUAGES = new Set(["hcl"]);

/**
 * Initialize tree-sitter (once). Safe to call multiple times – subsequent
 * calls return the same promise.
 */
async function initTreeSitter(): Promise<void> {
  if (parserInstance) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Dynamic import so the WASM is only loaded in the browser
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import("web-tree-sitter");
    const TS: TSModule = mod.default ?? mod;
    TreeSitter = TS;

    // In Next.js the `public/` folder is served at `/`.
    await TS.init({
      locateFile: () => "/tree-sitter/tree-sitter.wasm",
    });

    parserInstance = new TS();
  })();

  return initPromise;
}

/** Load (and cache) a language grammar by language id */
async function loadLanguage(langId: string): Promise<TSLanguage | null> {
  const cached = languageCache.get(langId);
  if (cached) return cached;

  if (!TreeSitter) return null;

  const wasmFile = WASM_GRAMMAR_MAP[langId];
  if (!wasmFile) return null;

  try {
    const lang = await TreeSitter.Language.load(`/tree-sitter/${wasmFile}.wasm`);
    languageCache.set(langId, lang);
    return lang;
  } catch (err) {
    console.warn(`[ast-parser] Failed to load grammar for "${langId}":`, err);
    return null;
  }
}

/** Returns true when tree-sitter can be used for `language` */
function treeSitterAvailable(language: string): boolean {
  if (typeof window === "undefined") return false; // SSR → no WASM
  if (REGEX_ONLY_LANGUAGES.has(language)) return false;
  return language in WASM_GRAMMAR_MAP;
}

// ── Internal: parse source → Tree ────────────────────────────────────────────

async function parseSource(
  content: string,
  language: string,
): Promise<TSTree | null> {
  await initTreeSitter();
  if (!parserInstance) return null;

  const lang = await loadLanguage(language);
  if (!lang) return null;

  parserInstance.setLanguage(lang);
  return parserInstance.parse(content);
}

// ── Tree-sitter → CodeSymbol helpers ─────────────────────────────────────────

function nodeSignature(node: TSSyntaxNode, lines: string[]): string {
  const firstLine = lines[node.startPosition.row] ?? "";
  const trimmed = firstLine.trimStart();
  return trimmed.split(/[{:]/)[0].trim();
}

function tsKindToSymbolKind(nodeType: string): SymbolKind | null {
  switch (nodeType) {
    // TypeScript / JavaScript
    case "function_declaration":
    case "generator_function_declaration":
    case "arrow_function":
      return "function";
    case "method_definition":
      return "method";
    case "class_declaration":
      return "class";
    case "interface_declaration":
      return "interface";
    case "type_alias_declaration":
      return "type";
    case "lexical_declaration":
    case "variable_declaration":
      return "variable";
    case "export_statement":
      return "export";
    case "import_statement":
      return "import";

    // Python
    case "function_definition":
      return "function";
    case "class_definition":
      return "class";
    case "decorated_definition":
      return null; // drill into the inner func/class

    // Go
    case "method_declaration":
      return "method";
    case "type_declaration":
      return "class";

    // Rust
    case "function_item":
      return "function";
    case "impl_item":
      return "class";
    case "struct_item":
      return "class";
    case "enum_item":
      return "class";
    case "trait_item":
      return "interface";

    default:
      return null;
  }
}

/** Resolve the user-visible name of a syntax node */
function resolveNodeName(node: TSSyntaxNode): string {
  const nameNode = node.childForFieldName("name");
  if (nameNode) return nameNode.text;

  // For variable declarations, try the first declarator's name
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (
      child.type === "variable_declarator" ||
      child.type === "lexical_binding"
    ) {
      const n = child.childForFieldName("name");
      if (n) return n.text;
    }
  }

  return node.type;
}

/** Check if a variable declaration contains a function expression or arrow */
function isVariableFunctionDecl(node: TSSyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (
      child.type === "variable_declarator" ||
      child.type === "lexical_binding"
    ) {
      const value = child.childForFieldName("value");
      if (!value) continue;
      if (
        value.type === "arrow_function" ||
        value.type === "function_expression" ||
        value.type === "function"
      ) {
        return true;
      }
    }
  }
  return false;
}

// ── Tree-sitter symbol extraction per language ───────────────────────────────

const TS_NODE_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "lexical_declaration",
  "variable_declaration",
  "export_statement",
  "method_definition",
]);

const PYTHON_NODE_TYPES = new Set([
  "function_definition",
  "class_definition",
  "decorated_definition",
]);

const GO_NODE_TYPES = new Set([
  "function_declaration",
  "method_declaration",
  "type_declaration",
]);

const RUST_NODE_TYPES = new Set([
  "function_item",
  "impl_item",
  "struct_item",
  "enum_item",
  "trait_item",
]);

function getInterestingNodeTypes(language: string): Set<string> {
  switch (language) {
    case "typescript":
    case "javascript":
      return TS_NODE_TYPES;
    case "python":
      return PYTHON_NODE_TYPES;
    case "go":
      return GO_NODE_TYPES;
    case "rust":
      return RUST_NODE_TYPES;
    default:
      return new Set<string>();
  }
}

/** Walk the tree and collect top-level symbols */
function collectSymbolsFromTree(
  tree: TSTree,
  lines: string[],
  language: string,
): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const interestingTypes = getInterestingNodeTypes(language);

  function visit(node: TSSyntaxNode) {
    if (interestingTypes.has(node.type)) {
      let kind = tsKindToSymbolKind(node.type);

      // For Python decorated_definition, drill into the inner node
      if (node.type === "decorated_definition") {
        const inner =
          node.childForFieldName("definition") ??
          node.children.find(
            (c: TSSyntaxNode) =>
              c.type === "function_definition" || c.type === "class_definition",
          );
        if (inner) {
          const innerKind = tsKindToSymbolKind(inner.type);
          if (innerKind) {
            symbols.push({
              name: resolveNodeName(inner),
              kind: innerKind,
              startLine: node.startPosition.row + 1,
              endLine: node.endPosition.row + 1,
              indent: node.startPosition.column,
              signature: nodeSignature(inner, lines),
              children: collectChildren(inner, lines, language),
            });
          }
        }
        return;
      }

      // For export_statement, unwrap the declaration inside it
      if (node.type === "export_statement") {
        const decl =
          node.childForFieldName("declaration") ??
          node.children.find((c: TSSyntaxNode) => interestingTypes.has(c.type));
        if (decl) {
          visit(decl);
          return;
        }
        return;
      }

      // Variable declarations that are really function expressions
      if (
        (node.type === "lexical_declaration" ||
          node.type === "variable_declaration") &&
        isVariableFunctionDecl(node)
      ) {
        kind = "function";
      }

      if (kind) {
        symbols.push({
          name: resolveNodeName(node),
          kind,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
          indent: node.startPosition.column,
          signature: nodeSignature(node, lines),
          children: collectChildren(node, lines, language),
        });
        return;
      }
    }

    // Recurse for non-matched nodes
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) visit(child);
    }
  }

  visit(tree.rootNode);
  return symbols;
}

/**
 * Collect method-level children inside a class/struct/impl node.
 */
function collectChildren(
  parentNode: TSSyntaxNode,
  lines: string[],
  _language: string,
): CodeSymbol[] | undefined {
  const children: CodeSymbol[] = [];
  const methodTypes = new Set([
    "method_definition",
    "function_definition",
    "function_item",
    "method_declaration",
  ]);

  function walk(node: TSSyntaxNode) {
    if (methodTypes.has(node.type)) {
      children.push({
        name: resolveNodeName(node),
        kind: "method",
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        indent: node.startPosition.column,
        signature: nodeSignature(node, lines),
      });
      return;
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child);
    }
  }

  const body =
    parentNode.childForFieldName("body") ??
    parentNode.children.find(
      (c: TSSyntaxNode) =>
        c.type === "class_body" ||
        c.type === "block" ||
        c.type === "declaration_list",
    );
  if (body) walk(body);

  return children.length > 0 ? children : undefined;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Synchronous symbol extraction (regex-based). Works everywhere (SSR + browser). */
export function extractSymbols(content: string, language: string): CodeSymbol[] {
  switch (language) {
    case "typescript":
    case "javascript":
      return extractTSSymbolsRegex(content);
    case "python":
      return extractPythonSymbolsRegex(content);
    case "hcl":
      return extractTerraformSymbols(content);
    case "go":
      return extractGoSymbolsRegex(content);
    case "rust":
      return extractRustSymbolsRegex(content);
    default:
      return extractGenericSymbols(content);
  }
}

/**
 * **Async** symbol extraction via true tree-sitter AST.
 *
 * Falls back to `extractSymbols` (regex) when tree-sitter is unavailable
 * (SSR, unsupported language, grammar load failure).
 */
export async function extractSymbolsAST(
  content: string,
  language: string,
): Promise<CodeSymbol[]> {
  if (!treeSitterAvailable(language)) {
    return extractSymbols(content, language);
  }

  try {
    const tree = await parseSource(content, language);
    if (!tree) return extractSymbols(content, language);

    const lines = content.split("\n");
    const symbols = collectSymbolsFromTree(tree, lines, language);
    tree.delete();

    return symbols.length > 0 ? symbols : extractSymbols(content, language);
  } catch (err) {
    console.warn("[ast-parser] tree-sitter extraction failed, using regex fallback:", err);
    return extractSymbols(content, language);
  }
}

/**
 * Parse source into a raw tree-sitter Tree (for advanced consumers that
 * need direct node traversal, e.g. the Code-Editor Agent).
 */
export async function parseToTree(
  content: string,
  language: string,
): Promise<TSTree | null> {
  if (!treeSitterAvailable(language)) return null;
  return parseSource(content, language);
}

/**
 * Extract a specific symbol by name with ±contextLines of surrounding context.
 * Uses tree-sitter when available.
 */
export async function extractChunkAST(
  content: string,
  symbolName: string,
  language: string,
  contextLines = 5,
): Promise<ExtractedChunk | null> {
  const symbols = await extractSymbolsAST(content, language);
  const symbol = symbols.find(
    (s) => s.name === symbolName || s.name.includes(symbolName),
  );
  if (!symbol) return null;

  return buildChunkFromSymbol(content, symbol, contextLines);
}

/** Synchronous chunk extraction (regex path) — backward-compatible */
export function extractChunk(
  content: string,
  symbolName: string,
  language: string,
  contextLines = 5,
): ExtractedChunk | null {
  const symbols = extractSymbols(content, language);
  const symbol = symbols.find(
    (s) => s.name === symbolName || s.name.includes(symbolName),
  );
  if (!symbol) return null;

  return buildChunkFromSymbol(content, symbol, contextLines);
}

function buildChunkFromSymbol(
  content: string,
  symbol: CodeSymbol,
  contextLines: number,
): ExtractedChunk {
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

/** Extract the symbol containing a specific line number */
export function extractSymbolAtLine(
  content: string,
  lineNumber: number,
  language: string,
): CodeSymbol | null {
  const symbols = extractSymbols(content, language);
  return (
    symbols.find((s) => lineNumber >= s.startLine && lineNumber <= s.endLine) ??
    null
  );
}

/** Async version — uses tree-sitter when available */
export async function extractSymbolAtLineAST(
  content: string,
  lineNumber: number,
  language: string,
): Promise<CodeSymbol | null> {
  const symbols = await extractSymbolsAST(content, language);
  return (
    symbols.find((s) => lineNumber >= s.startLine && lineNumber <= s.endLine) ??
    null
  );
}

// ── Import Graph ─────────────────────────────────────────────────────────────

export interface ImportInfo {
  source: string;
  specifiers: string[];
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
        specifiers: match[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
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
    match = line.match(
      /(?:const|let|var)\s+(\w+)\s*=\s*require\s*\(\s*["']([^"']+)["']\s*\)/,
    );
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
    const deps = imports
      .map((i) => i.source)
      .filter((s) => s.startsWith(".") || s.startsWith("@/"));
    depMap.set(path, deps);
  }

  return depMap;
}

// ══════════════════════════════════════════════════════════════════════════════
// REGEX FALLBACK EXTRACTORS
// Used when tree-sitter is not available (SSR, unsupported language).
// ══════════════════════════════════════════════════════════════════════════════

// ── TypeScript / JavaScript (regex) ──────────────────────────────────────────

function extractTSSymbolsRegex(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  const patterns: Array<{ regex: RegExp; kind: SymbolKind }> = [
    { regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/, kind: "function" },
    {
      regex:
        /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\(|function)/,
      kind: "function",
    },
    { regex: /^(?:export\s+)?class\s+(\w+)/, kind: "class" },
    { regex: /^(?:export\s+)?interface\s+(\w+)/, kind: "interface" },
    { regex: /^(?:export\s+)?type\s+(\w+)/, kind: "type" },
    {
      regex: /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*(?::\s*\w+)?\s*=/,
      kind: "variable",
    },
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

// ── Python (regex) ───────────────────────────────────────────────────────────

function extractPythonSymbolsRegex(content: string): CodeSymbol[] {
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

    match = trimmed.match(
      /^(variable|output|data|locals|module|provider)\s+"?(\w+)"?/,
    );
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

// ── Go (regex) ──────────────────────────────────────────────────────────────

function extractGoSymbolsRegex(content: string): CodeSymbol[] {
  const lines = content.split("\n");
  const symbols: CodeSymbol[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    let match = trimmed.match(
      /^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/,
    );
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

// ── Rust (regex) ─────────────────────────────────────────────────────────────

function extractRustSymbolsRegex(content: string): CodeSymbol[] {
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
    const match = trimmed.match(
      /^(?:function|def|fn|func|class|struct|interface|type|resource)\s+(\w+)/,
    );
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

// ── Shared Helpers ───────────────────────────────────────────────────────────

/** Find matching closing brace for a block that starts on or after `startIdx` */
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

  return Math.min(startIdx + 50, lines.length - 1);
}

/** Find end of a Python block using indentation */
function findPythonBlockEnd(
  lines: string[],
  startIdx: number,
  baseIndent: number,
): number {
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
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
    if (sym.startLine > lastEnd || sym.kind === "method") {
      result.push(sym);
      if (sym.endLine > lastEnd) lastEnd = sym.endLine;
    }
  }

  return result;
}