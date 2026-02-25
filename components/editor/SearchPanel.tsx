/**
 * SearchPanel — Full-text search across the repo using FlexSearch.
 * Supports file path fuzzy search and content grep with line-level results.
 */

"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useRepoStore } from "@/store/repo-store";
import { searchFiles, searchPaths, buildSearchIndex, type SearchResult } from "@/lib/search-engine";

export default function SearchPanel() {
  const { openFile } = useRepoStore();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"content" | "files">("content");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [pathResults, setPathResults] = useState<string[]>([]);
  const [searching, setSearching] = useState(false);
  const [indexed, setIndexed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout>(null);

  // Build index on mount
  useEffect(() => {
    buildSearchIndex().then(() => setIndexed(true));
  }, []);

  // Debounced search
  const doSearch = useCallback(
    (q: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(async () => {
        if (!q.trim()) {
          setResults([]);
          setPathResults([]);
          return;
        }
        setSearching(true);
        if (mode === "content") {
          const res = await searchFiles(q, 30);
          setResults(res);
        } else {
          const res = await searchPaths(q);
          setPathResults(res);
        }
        setSearching(false);
      }, 200);
    },
    [mode],
  );

  const handleChange = (value: string) => {
    setQuery(value);
    doSearch(value);
  };

  const handleResultClick = (path: string) => {
    openFile(path);
  };

  // Rebuild index when triggered
  const handleReindex = async () => {
    setIndexed(false);
    await buildSearchIndex();
    setIndexed(true);
    if (query) doSearch(query);
  };

  return (
    <div className="search-panel">
      <div className="search-panel-header">
        <span className="panel-title">
          Search <span className="accent">Repo</span>
        </span>
        <div className="search-mode-toggle">
          <button
            className={`search-mode-btn ${mode === "content" ? "active" : ""}`}
            onClick={() => setMode("content")}
          >
            Content
          </button>
          <button
            className={`search-mode-btn ${mode === "files" ? "active" : ""}`}
            onClick={() => setMode("files")}
          >
            Files
          </button>
        </div>
      </div>

      <div className="search-input-wrap">
        <span className="search-icon">🔍</span>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder={mode === "content" ? "Search in files…" : "Search file names…"}
          value={query}
          onChange={(e) => handleChange(e.target.value)}
        />
        {query && (
          <button className="search-clear" onClick={() => { setQuery(""); setResults([]); setPathResults([]); }}>
            ×
          </button>
        )}
      </div>

      <div className="search-results">
        {!indexed && (
          <div className="search-indexing">
            <div className="editor-loading-spinner" />
            <span>Building search index…</span>
          </div>
        )}

        {searching && <div className="search-status">Searching…</div>}

        {mode === "content" && results.length > 0 && (
          <div className="search-result-list">
            <div className="search-result-count">{results.length} results</div>
            {results.map((r, i) => (
              <div
                key={`${r.path}:${r.line}:${i}`}
                className="search-result-item"
                onClick={() => handleResultClick(r.path)}
              >
                <div className="search-result-file">
                  {r.path}
                  <span className="search-result-line">:{r.line}</span>
                </div>
                <div className="search-result-text">{r.text}</div>
              </div>
            ))}
          </div>
        )}

        {mode === "files" && pathResults.length > 0 && (
          <div className="search-result-list">
            <div className="search-result-count">{pathResults.length} files</div>
            {pathResults.map((path) => (
              <div
                key={path}
                className="search-result-item"
                onClick={() => handleResultClick(path)}
              >
                <div className="search-result-file">{path}</div>
              </div>
            ))}
          </div>
        )}

        {!searching && query && results.length === 0 && pathResults.length === 0 && indexed && (
          <div className="search-empty">
            <div style={{ fontSize: "1.2rem", marginBottom: "0.4rem" }}>🔍</div>
            <div>No results found</div>
          </div>
        )}

        {indexed && !query && (
          <div className="search-hint">
            <div style={{ fontSize: "0.7rem", color: "var(--ash)", lineHeight: 1.6 }}>
              <div>Search across all files in the browser repo.</div>
              <div style={{ marginTop: "0.5rem" }}>
                <button className="search-reindex-btn" onClick={handleReindex}>
                  ↻ Rebuild Index
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
