/**
 * search-engine.ts — FlexSearch-backed full-text search across the repo.
 * Builds an in-memory index from IndexedDB and supports instant file search.
 */

import { Index } from "flexsearch";
import { listFiles, readFile } from "@/lib/repo-db";

export interface SearchResult {
  path: string;
  line: number;
  text: string;
  matchStart: number;
  matchEnd: number;
}

// FlexSearch document index
let index: Index | null = null;
let pathMap: Map<number, string> = new Map();
let contentCache: Map<string, string> = new Map();

/** Initialize or rebuild the search index from IndexedDB */
export async function buildSearchIndex(): Promise<void> {
  index = new Index({
    tokenize: "forward",
    resolution: 9,
    cache: true,
  });

  pathMap = new Map();
  contentCache = new Map();

  const files = await listFiles();
  for (let i = 0; i < files.length; i++) {
    const path = files[i];
    const content = await readFile(path);
    if (content) {
      // Use numeric ID for FlexSearch
      const id = i;
      pathMap.set(id, path);
      contentCache.set(path, content);
      index.add(id, `${path}\n${content}`);
    }
  }
}

/** Update index for a single file */
export async function updateSearchIndex(path: string, content: string): Promise<void> {
  if (!index) await buildSearchIndex();
  if (!index) return;

  // Find existing id or assign new one
  let existingId: number | null = null;
  for (const [id, p] of pathMap.entries()) {
    if (p === path) {
      existingId = id;
      break;
    }
  }

  const id = existingId ?? pathMap.size;
  pathMap.set(id, path);
  contentCache.set(path, content);

  if (existingId !== null) {
    index.update(id, `${path}\n${content}`);
  } else {
    index.add(id, `${path}\n${content}`);
  }
}

/** Remove a file from the index */
export async function removeFromIndex(path: string): Promise<void> {
  if (!index) return;
  for (const [id, p] of pathMap.entries()) {
    if (p === path) {
      index.remove(id);
      pathMap.delete(id);
      contentCache.delete(path);
      break;
    }
  }
}

/** Search files by query and return line-level matches */
export async function searchFiles(
  query: string,
  maxResults = 50,
): Promise<SearchResult[]> {
  if (!index) await buildSearchIndex();
  if (!index || !query.trim()) return [];

  const ids = index.search(query, { limit: 100 });
  const results: SearchResult[] = [];
  const lowerQuery = query.toLowerCase();

  for (const id of ids) {
    const path = pathMap.get(id as number);
    if (!path) continue;

    const content = contentCache.get(path);
    if (!content) continue;

    const lines = content.split("\n");
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      const matchIdx = line.toLowerCase().indexOf(lowerQuery);
      if (matchIdx !== -1) {
        results.push({
          path,
          line: lineIdx + 1,
          text: line.trimStart(),
          matchStart: matchIdx,
          matchEnd: matchIdx + query.length,
        });
        if (results.length >= maxResults) return results;
      }
    }
  }

  return results;
}

/** Search file paths only (for quick-open / fuzzy-finder) */
export async function searchPaths(query: string): Promise<string[]> {
  if (!query.trim()) {
    const files = await listFiles();
    return files.slice(0, 20);
  }

  const lower = query.toLowerCase();
  const files = await listFiles();
  return files
    .filter((f) => f.toLowerCase().includes(lower))
    .sort((a, b) => {
      // Prefer matches at start of filename
      const aName = a.split("/").pop()?.toLowerCase() ?? "";
      const bName = b.split("/").pop()?.toLowerCase() ?? "";
      const aStartsWith = aName.startsWith(lower) ? -1 : 0;
      const bStartsWith = bName.startsWith(lower) ? -1 : 0;
      return aStartsWith - bStartsWith || a.length - b.length;
    })
    .slice(0, 20);
}
