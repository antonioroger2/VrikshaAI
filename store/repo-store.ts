/**
 * repo-store.ts — Zustand store that wraps the IndexedDB repo.
 * Single source of truth for file tree, active file, editor content,
 * dirty tracking, and repo-level operations.
 */

import { create } from "zustand";
import {
  saveFile,
  readFile,
  listFiles,
  deleteFile as dbDeleteFile,
  renameFile as dbRenameFile,
  bulkImport,
  clearRepo,
  detectLanguage,
} from "@/lib/repo-db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FileTab {
  path: string;
  dirty: boolean;
}

export interface RepoState {
  // File system
  files: string[];
  activeFile: string | null;
  content: string;
  language: string;
  openTabs: FileTab[];

  // Dirty tracking
  originalContent: string; // content on disk (IndexedDB)

  // Actions
  loadRepo: () => Promise<void>;
  openFile: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  updateContent: (code: string) => void;
  saveCurrentFile: () => Promise<void>;
  createFile: (path: string, content?: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  importFiles: (files: Record<string, string>) => Promise<void>;
  clearAll: () => Promise<void>;
  createFolder: (path: string) => Promise<void>;
}

export const useRepoStore = create<RepoState>((set, get) => ({
  files: [],
  activeFile: null,
  content: "",
  language: "plaintext",
  openTabs: [],
  originalContent: "",

  loadRepo: async () => {
    const files = await listFiles();
    files.sort();
    set({ files });
  },

  openFile: async (path: string) => {
    const content = (await readFile(path)) ?? "";
    const lang = detectLanguage(path);
    const { openTabs } = get();
    const alreadyOpen = openTabs.find((t) => t.path === path);
    const newTabs = alreadyOpen
      ? openTabs
      : [...openTabs, { path, dirty: false }];

    set({
      activeFile: path,
      content,
      originalContent: content,
      language: lang,
      openTabs: newTabs,
    });
  },

  closeTab: (path: string) => {
    const { openTabs, activeFile } = get();
    const newTabs = openTabs.filter((t) => t.path !== path);
    if (activeFile === path) {
      const nextTab = newTabs[newTabs.length - 1];
      if (nextTab) {
        get().openFile(nextTab.path);
      } else {
        set({ activeFile: null, content: "", originalContent: "", language: "plaintext", openTabs: [] });
      }
    } else {
      set({ openTabs: newTabs });
    }
  },

  updateContent: (code: string) => {
    const { activeFile, originalContent, openTabs } = get();
    if (!activeFile) return;
    const dirty = code !== originalContent;
    const newTabs = openTabs.map((t) =>
      t.path === activeFile ? { ...t, dirty } : t,
    );
    set({ content: code, openTabs: newTabs });
  },

  saveCurrentFile: async () => {
    const { activeFile, content, openTabs } = get();
    if (!activeFile) return;
    await saveFile(activeFile, content);
    const newTabs = openTabs.map((t) =>
      t.path === activeFile ? { ...t, dirty: false } : t,
    );
    set({ originalContent: content, openTabs: newTabs });
  },

  createFile: async (path: string, content = "") => {
    await saveFile(path, content);
    await get().loadRepo();
    await get().openFile(path);
  },

  deleteFile: async (path: string) => {
    await dbDeleteFile(path);
    get().closeTab(path);
    await get().loadRepo();
  },

  renameFile: async (oldPath: string, newPath: string) => {
    await dbRenameFile(oldPath, newPath);
    const { openTabs, activeFile } = get();
    const newTabs = openTabs.map((t) =>
      t.path === oldPath ? { ...t, path: newPath } : t,
    );
    set({ openTabs: newTabs });
    if (activeFile === oldPath) {
      await get().openFile(newPath);
    }
    await get().loadRepo();
  },

  importFiles: async (files: Record<string, string>) => {
    await bulkImport(files);
    await get().loadRepo();
  },

  clearAll: async () => {
    await clearRepo();
    set({
      files: [],
      activeFile: null,
      content: "",
      originalContent: "",
      language: "plaintext",
      openTabs: [],
    });
  },

  createFolder: async (path: string) => {
    // Folders are virtual — store a .gitkeep sentinel
    const sentinel = path.endsWith("/") ? `${path}.gitkeep` : `${path}/.gitkeep`;
    await saveFile(sentinel, "");
    await get().loadRepo();
  },
}));
