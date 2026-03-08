/**
 * EditorWorkspace — Main layout that composes the full code editor experience:
 *   Toolbar + Sidebar (FileTree or Search) + Monaco Editor
 *
 * This replaces the old VrikshaApp mock with a real, functional dev tool.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRepoStore } from "@/store/repo-store";
import { buildSearchIndex } from "@/lib/search-engine";
import Toolbar from "./Toolbar";
import FileTree from "./FileTree";
import CodeEditor from "./CodeEditor";
import SearchPanel from "./SearchPanel";

export default function EditorWorkspace() {
  const loadRepo = useRepoStore((s) => s.loadRepo);
  const [activePanel, setActivePanel] = useState<"files" | "search">("files");
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [ready, setReady] = useState(false);

  // Initialize repo + search index on mount
  useEffect(() => {
    (async () => {
      await loadRepo();
      await buildSearchIndex();
      setReady(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+B toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setActivePanel((prev) => (prev === "files" ? "files" : "files")); // Just ensure sidebar visible
      }
      // Ctrl+Shift+F open search
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
        e.preventDefault();
        setActivePanel("search");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Sidebar resize handler
  const handleSidebarResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      setSidebarWidth(Math.max(200, Math.min(500, startWidth + delta)));
    };
    const onMouseUp = () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, [sidebarWidth]);

  if (!ready) {
    return (
      <div className="workspace-loading">
        <div className="editor-loading-spinner" />
        <div className="workspace-loading-text">Initializing VRIKSHA Editor…</div>
      </div>
    );
  }

  return (
    <div className="workspace">
      <Toolbar activePanel={activePanel} setActivePanel={setActivePanel} />

      <div className="workspace-body">
        {/* Left sidebar */}
        <div className="workspace-sidebar" style={{ width: sidebarWidth }}>
          {activePanel === "files" && <FileTree />}
          {activePanel === "search" && <SearchPanel />}
        </div>

        {/* Resize handle */}
        <div className="workspace-resize-handle" onMouseDown={handleSidebarResize} />

        {/* Editor */}
        <div className="workspace-editor">
          <CodeEditor />
        </div>
      </div>

      {/* Status bar */}
      <div className="workspace-statusbar">
        <div className="statusbar-left">
          <span className="status-dot" />
          <span>VRIKSHA.ai</span>
          <span className="statusbar-sep">·</span>
          <span>Local-first</span>
          <span className="statusbar-sep">·</span>
          <span>IndexedDB</span>
        </div>
        <div className="statusbar-right">
          <span>Ctrl+Shift+F Search</span>
          <span className="statusbar-sep">·</span>
          <span>Ctrl+S Save</span>
        </div>
      </div>
    </div>
  );
}
