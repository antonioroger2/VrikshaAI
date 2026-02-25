/**
 * repo-db.ts — IndexedDB-backed file system for the browser.
 * Uses the `idb` library for a promise-friendly API.
 *
 * Schema:
 *   DB "agent-repo" v1
 *     ObjectStore "files"   — key = file path (string), value = file content (string)
 *     ObjectStore "meta"    — key = file path, value = { createdAt, updatedAt, language }
 */

import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "agent-repo";
const DB_VERSION = 2;
const FILES_STORE = "files";
const META_STORE = "meta";

export interface FileMeta {
  path: string;
  createdAt: number;
  updatedAt: number;
  language: string;
  size: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          db.createObjectStore(FILES_STORE);
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(META_STORE)) {
            db.createObjectStore(META_STORE);
          }
        }
      },
    });
  }
  return dbPromise;
}

// ── File CRUD ─────────────────────────────────────────────────────────────────

/** Save or overwrite a file */
export async function saveFile(path: string, content: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([FILES_STORE, META_STORE], "readwrite");
  const now = Date.now();

  const existingMeta = await tx.objectStore(META_STORE).get(path);
  const meta: FileMeta = {
    path,
    createdAt: existingMeta?.createdAt ?? now,
    updatedAt: now,
    language: detectLanguage(path),
    size: new Blob([content]).size,
  };

  await tx.objectStore(FILES_STORE).put(content, path);
  await tx.objectStore(META_STORE).put(meta, path);
  await tx.done;
}

/** Read file content; returns undefined if not found */
export async function readFile(path: string): Promise<string | undefined> {
  const db = await getDB();
  return db.get(FILES_STORE, path);
}

/** List all file paths */
export async function listFiles(): Promise<string[]> {
  const db = await getDB();
  const keys = await db.getAllKeys(FILES_STORE);
  return keys as string[];
}

/** Delete a file */
export async function deleteFile(path: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([FILES_STORE, META_STORE], "readwrite");
  await tx.objectStore(FILES_STORE).delete(path);
  await tx.objectStore(META_STORE).delete(path);
  await tx.done;
}

/** Get metadata for a file */
export async function getFileMeta(path: string): Promise<FileMeta | undefined> {
  const db = await getDB();
  return db.get(META_STORE, path);
}

/** Get all file metadata */
export async function getAllMeta(): Promise<FileMeta[]> {
  const db = await getDB();
  return db.getAll(META_STORE);
}

/** Rename / move a file */
export async function renameFile(oldPath: string, newPath: string): Promise<void> {
  const content = await readFile(oldPath);
  if (content === undefined) throw new Error(`File not found: ${oldPath}`);
  await saveFile(newPath, content);
  await deleteFile(oldPath);
}

/** Bulk-import a map of { path → content } */
export async function bulkImport(files: Record<string, string>): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([FILES_STORE, META_STORE], "readwrite");
  const now = Date.now();

  for (const [path, content] of Object.entries(files)) {
    await tx.objectStore(FILES_STORE).put(content, path);
    await tx.objectStore(META_STORE).put(
      {
        path,
        createdAt: now,
        updatedAt: now,
        language: detectLanguage(path),
        size: new Blob([content]).size,
      } satisfies FileMeta,
      path,
    );
  }
  await tx.done;
}

/** Nuke everything */
export async function clearRepo(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction([FILES_STORE, META_STORE], "readwrite");
  await tx.objectStore(FILES_STORE).clear();
  await tx.objectStore(META_STORE).clear();
  await tx.done;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  tf: "hcl",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  css: "css",
  html: "html",
  sh: "shell",
  bash: "shell",
  rs: "rust",
  go: "go",
  java: "java",
  rb: "ruby",
  dart: "dart",
  sql: "sql",
  toml: "toml",
  xml: "xml",
  dockerfile: "dockerfile",
};

export function detectLanguage(path: string): string {
  const basename = path.split("/").pop() ?? "";
  if (basename.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = basename.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MAP[ext] ?? "plaintext";
}
