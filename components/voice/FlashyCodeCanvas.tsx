/**
 * FlashyCodeCanvas — Read-only code display panel (right side, 40%).
 *
 * Features:
 *  - File tree: file names slide-in with green glow when newly created
 *  - Typewriter code reveal when a file is opened/updated
 *  - "NEW" badge on freshly created files (2-second flash window)
 *  - "flash-update" CSS class while typing for neon glow effect
 */
"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRepoStore } from "@/store/repo-store";

// ── File icon helper ─────────────────────────────────────────────────────────

const FILE_ICONS: Record<string, string> = {
  ts: "🔷", tsx: "⚛️", js: "🟡", jsx: "⚛️", py: "🐍",
  json: "📋", md: "📝", css: "🎨", html: "🌐",
  yaml: "⚙️", yml: "⚙️", sh: "💻", sql: "🗄️",
  tf: "🏗️", go: "🐹", rs: "🦀", toml: "⚙️",
};

function fileIcon(path: string) {
  const ext = path.split(".").pop() ?? "";
  return FILE_ICONS[ext] ?? "📄";
}

function shortName(path: string) {
  return path.split("/").pop() ?? path;
}

// ── Typewriter hook ──────────────────────────────────────────────────────────

function useTypewriter(target: string, chunkSize = 8, tickMs = 7) {
  const [displayed, setDisplayed] = useState("");
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!target) {
      setDisplayed("");
      setTyping(false);
      return;
    }
    setTyping(true);
    setDisplayed("");
    let i = 0;
    const tick = () => {
      i += chunkSize;
      if (i >= target.length) {
        setDisplayed(target);
        setTyping(false);
        return;
      }
      setDisplayed(target.slice(0, i));
      timer.current = setTimeout(tick, tickMs);
    };
    timer.current = setTimeout(tick, tickMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  // Only re-run when target changes (content + activeFile)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return { displayed, typing };
}

// ── Component ────────────────────────────────────────────────────────────────

export default function FlashyCodeCanvas() {
  const { files, activeFile, content, openFile } = useRepoStore();
  const [flashingFiles, setFlashingFiles] = useState<Set<string>>(new Set());
  const [neonFlash, setNeonFlash] = useState(false);
  const prevFiles = useRef<string[]>([]);
  const prevContent = useRef<string>("");

  // Composite key so typewriter re-triggers on any content OR file switch
  const typewriterTarget = activeFile ? content : "";
  const { displayed, typing } = useTypewriter(typewriterTarget);

  // Detect newly added files → flash them for 2 s
  useEffect(() => {
    const newFiles = files.filter((f) => !prevFiles.current.includes(f));
    if (newFiles.length === 0) {
      prevFiles.current = files;
      return;
    }
    setFlashingFiles((prev) => {
      const next = new Set(prev);
      newFiles.forEach((f) => next.add(f));
      return next;
    });
    const timer = setTimeout(() => {
      setFlashingFiles((prev) => {
        const next = new Set(prev);
        newFiles.forEach((f) => next.delete(f));
        return next;
      });
    }, 2000);
    prevFiles.current = files;
    return () => clearTimeout(timer);
  }, [files]);

  // Trigger neon flash when content changes (new code generated/edited)
  useEffect(() => {
    if (content && content !== prevContent.current && prevContent.current !== "") {
      setNeonFlash(true);
      const timer = setTimeout(() => setNeonFlash(false), 1500);
      prevContent.current = content;
      return () => clearTimeout(timer);
    }
    prevContent.current = content;
  }, [content]);

  return (
    <div className="vw-canvas-panel">
      {/* ── File tree ── */}
      <div className="vw-canvas-filetree">
        <div className="vw-canvas-filetree-header">FILES</div>

        {files.length === 0 && (
          <div className="vw-canvas-empty-files">Awaiting files…</div>
        )}

        <AnimatePresence>
          {files.map((f) => {
            const flashing = flashingFiles.has(f);
            return (
              <motion.div
                key={f}
                layout
                className={[
                  "vw-canvas-file",
                  activeFile === f ? "vw-canvas-file--active" : "",
                  flashing ? "vw-canvas-file--flash" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => openFile(f)}
                /* Slide in from top when newly created */
                initial={flashing ? { y: -28, opacity: 0 } : false}
                animate={{ y: 0, opacity: 1 }}
                transition={
                  flashing
                    ? { type: "spring", stiffness: 420, damping: 22 }
                    : { duration: 0 }
                }
                title={f}
              >
                <span className="vw-canvas-file-icon" aria-hidden="true">
                  {fileIcon(f)}
                </span>
                <span className="vw-canvas-file-name">{shortName(f)}</span>
                {flashing && <span className="vw-new-badge">NEW</span>}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── Code display ── */}
      <div className="vw-canvas-code-area">
        {activeFile ? (
          <>
            <div className="vw-canvas-code-header">
              <span className="vw-canvas-filename">{activeFile}</span>
              {typing && <span className="vw-writing-badge">⚡ Writing…</span>}
            </div>

            <pre className={`vw-canvas-code ${typing ? "typing-glow" : ""} ${neonFlash && !typing ? "neon-flash-in" : ""}`}>
              <code>
                {displayed}
                {typing && <span className="vw-cursor-blink" aria-hidden="true">▋</span>}
              </code>
            </pre>
          </>
        ) : (
          <motion.div
            className="vw-canvas-placeholder"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          >
            <span className="vw-canvas-placeholder-icon">🌿</span>
            <p>The AI will build your code here in real time.</p>
            <p className="vw-canvas-placeholder-sub">
              Select a file from the tree or ask VRIKSHA to create one.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
}
