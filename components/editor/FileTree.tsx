/**
 * FileTree — Hierarchical file explorer with expand/collapse, right-click context menu,
 * new file/folder creation, rename, and delete.
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRepoStore } from "@/store/repo-store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  depth: number;
}

// ── Build tree structure from flat paths ──────────────────────────────────────

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", isDir: true, children: [], depth: -1 };

  for (const path of paths) {
    const parts = path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");

      let child = current.children.find((c) => c.name === part);
      if (!child) {
        child = {
          name: part,
          path: fullPath,
          isDir: !isLast,
          children: [],
          depth: i,
        };
        current.children.push(child);
      }
      if (!isLast) {
        child.isDir = true;
      }
      current = child;
    }
  }

  // Sort: dirs first, then alphabetical
  const sortNodes = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root.children);

  return root.children;
}

// ── File icon helper ──────────────────────────────────────────────────────────

function fileIcon(name: string, isDir: boolean, expanded: boolean): string {
  if (isDir) return expanded ? "📂" : "📁";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx": return "🟦";
    case "js":
    case "jsx": return "🟨";
    case "tf":  return "🟪";
    case "py":  return "🐍";
    case "json": return "📋";
    case "css": return "🎨";
    case "html": return "🌐";
    case "md":  return "📝";
    case "yaml":
    case "yml": return "⚙️";
    case "sh":
    case "bash": return "🖥️";
    default: return "📄";
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FileTree() {
  const { files, activeFile, openFile, createFile, deleteFile, renameFile, loadRepo, createFolder } = useRepoStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; isDir: boolean } | null>(null);
  const [creating, setCreating] = useState<{ parentPath: string; type: "file" | "folder" } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const tree = buildTree(files);

  // Auto-expand to active file path
  useEffect(() => {
    if (activeFile) {
      const parts = activeFile.split("/");
      const newExpanded = new Set(expanded);
      for (let i = 1; i < parts.length; i++) {
        newExpanded.add(parts.slice(0, i).join("/"));
      }
      setExpanded(newExpanded);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile]);

  // Close context menu on click outside
  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  // Focus input when creating/renaming
  useEffect(() => {
    inputRef.current?.focus();
  }, [creating, renaming]);

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, isDir: boolean) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, path, isDir });
  }, []);

  const handleCreate = async (name: string) => {
    if (!name.trim() || !creating) return;
    const parentPath = creating.parentPath;
    const fullPath = parentPath ? `${parentPath}/${name}` : name;

    if (creating.type === "folder") {
      await createFolder(fullPath);
    } else {
      await createFile(fullPath, "");
    }
    setCreating(null);
    setNewName("");
  };

  const handleRename = async (oldPath: string, name: string) => {
    if (!name.trim()) { setRenaming(null); return; }
    const parts = oldPath.split("/");
    parts[parts.length - 1] = name;
    const newPath = parts.join("/");
    if (newPath !== oldPath) {
      await renameFile(oldPath, newPath);
    }
    setRenaming(null);
    setNewName("");
  };

  const handleDelete = async (path: string) => {
    if (confirm(`Delete "${path}"?`)) {
      await deleteFile(path);
    }
  };

  // ── Render tree node ──────────────────────────────────────────────────────

  const renderNode = (node: TreeNode): React.ReactNode => {
    const isExpanded = expanded.has(node.path);
    const isActive = node.path === activeFile;
    const isRenaming = renaming === node.path;

    return (
      <div key={node.path}>
        <div
          className={`file-tree-item ${isActive ? "active" : ""} ${node.isDir ? "dir" : ""}`}
          style={{ paddingLeft: `${(node.depth + 1) * 16 + 8}px` }}
          onClick={() => {
            if (node.isDir) toggleExpand(node.path);
            else openFile(node.path);
          }}
          onContextMenu={(e) => handleContextMenu(e, node.path, node.isDir)}
        >
          <span className="file-tree-icon">
            {fileIcon(node.name, node.isDir, isExpanded)}
          </span>
          {isRenaming ? (
            <input
              ref={inputRef}
              className="file-tree-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename(node.path, newName);
                if (e.key === "Escape") setRenaming(null);
              }}
              onBlur={() => setRenaming(null)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="file-tree-name">{node.name}</span>
          )}
          {node.isDir && (
            <span className="file-tree-chevron">{isExpanded ? "▾" : "▸"}</span>
          )}
        </div>

        {node.isDir && isExpanded && (
          <div className="file-tree-children">
            {/* Creating new item inside this folder */}
            {creating && creating.parentPath === node.path && (
              <div className="file-tree-item creating" style={{ paddingLeft: `${(node.depth + 2) * 16 + 8}px` }}>
                <span className="file-tree-icon">{creating.type === "folder" ? "📁" : "📄"}</span>
                <input
                  ref={inputRef}
                  className="file-tree-input"
                  placeholder={creating.type === "folder" ? "folder name" : "filename.ext"}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate(newName);
                    if (e.key === "Escape") { setCreating(null); setNewName(""); }
                  }}
                  onBlur={() => { setCreating(null); setNewName(""); }}
                />
              </div>
            )}
            {node.children.map(renderNode)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="file-tree">
      <div className="file-tree-header">
        <span className="panel-title">
          Explorer <span className="accent">Files</span>
        </span>
        <div className="file-tree-actions">
          <button
            className="file-tree-action-btn"
            title="New File"
            onClick={() => { setCreating({ parentPath: "", type: "file" }); setNewName(""); }}
          >
            +📄
          </button>
          <button
            className="file-tree-action-btn"
            title="New Folder"
            onClick={() => { setCreating({ parentPath: "", type: "folder" }); setNewName(""); }}
          >
            +📁
          </button>
          <button className="file-tree-action-btn" title="Refresh" onClick={() => loadRepo()}>
            ↻
          </button>
        </div>
      </div>

      <div className="file-tree-body">
        {/* Root-level creation */}
        {creating && creating.parentPath === "" && (
          <div className="file-tree-item creating" style={{ paddingLeft: "8px" }}>
            <span className="file-tree-icon">{creating.type === "folder" ? "📁" : "📄"}</span>
            <input
              ref={inputRef}
              className="file-tree-input"
              placeholder={creating.type === "folder" ? "folder name" : "filename.ext"}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate(newName);
                if (e.key === "Escape") { setCreating(null); setNewName(""); }
              }}
              onBlur={() => { setCreating(null); setNewName(""); }}
            />
          </div>
        )}
        {tree.map(renderNode)}

        {files.length === 0 && (
          <div className="file-tree-empty">
            <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>🌱</div>
            <div>No files yet</div>
            <div style={{ fontSize: "0.6rem", marginTop: "0.25rem", opacity: 0.6 }}>
              Create a file or import a project
            </div>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="file-tree-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.isDir && (
            <>
              <button onClick={() => { setCreating({ parentPath: contextMenu.path, type: "file" }); setNewName(""); setContextMenu(null); setExpanded(prev => new Set(prev).add(contextMenu.path)); }}>
                New File
              </button>
              <button onClick={() => { setCreating({ parentPath: contextMenu.path, type: "folder" }); setNewName(""); setContextMenu(null); setExpanded(prev => new Set(prev).add(contextMenu.path)); }}>
                New Folder
              </button>
              <hr />
            </>
          )}
          <button onClick={() => { setRenaming(contextMenu.path); setNewName(contextMenu.path.split("/").pop() ?? ""); setContextMenu(null); }}>
            Rename
          </button>
          <button onClick={() => { handleDelete(contextMenu.path); setContextMenu(null); }} className="danger">
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
