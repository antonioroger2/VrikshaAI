/**
 * VoiceWorkspace — Main 55/45 split layout.
 *
 * Left  (55%) — Full EditorWorkspace (file tree, Monaco, agent panel, etc.)
 * Right (45%) — Socratic Chat + Input bar
 * Bottom      — LocalLinkTerminal drawer (fixed)
 *
 * The code editor sits quietly on the left until a file update happens,
 * at which point the FlashyCodeCanvas overlay pulses to draw attention.
 */
"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import SocraticChat from "./voice/SocraticChat";
import { type OrbState } from "./voice/VoiceOrb";
import FlashyCodeCanvas from "./voice/FlashyCodeCanvas";
import LocalLinkTerminal from "./voice/LocalLinkTerminal";
import EditorWorkspace from "./editor/EditorWorkspace";
import { useRepoStore } from "@/store/repo-store";

export default function VoiceWorkspace() {
  const DEFAULT_EDITOR_RATIO = 0.55;
  const MIN_AGENT_RATIO = 0.35;
  const MAX_EDITOR_RATIO = 1 - MIN_AGENT_RATIO;

  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [showCanvas, setShowCanvas] = useState(false);
  const [dividerX, setDividerX] = useState<number | null>(null);
  const files = useRepoStore((s) => s.files);

  // Flash the canvas overlay briefly when files change
  const [prevFileCount, setPrevFileCount] = useState(0);
  useEffect(() => {
    if (files.length > prevFileCount && prevFileCount > 0) {
      setShowCanvas(true);
      const timer = setTimeout(() => setShowCanvas(false), 4000);
      return () => clearTimeout(timer);
    }
    setPrevFileCount(files.length);
  }, [files.length, prevFileCount]);

  // Resizable divider
  const handleDividerDrag = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startRatio = dividerX ?? window.innerWidth * DEFAULT_EDITOR_RATIO;

      const onMove = (ev: MouseEvent) => {
        const minEditorWidth = window.innerWidth * 0.4;
        const maxEditorWidth = window.innerWidth * MAX_EDITOR_RATIO;
        const x = Math.max(
          minEditorWidth,
          Math.min(maxEditorWidth, startRatio + (ev.clientX - startX))
        );
        setDividerX(x);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [dividerX, DEFAULT_EDITOR_RATIO, MAX_EDITOR_RATIO]
  );

  const leftWidth = dividerX ? `${dividerX}px` : "55%";
  const rightWidth = dividerX ? `calc(100% - ${dividerX}px - 4px)` : "45%";

  return (
    <div className="voice-workspace">
      <div className="voice-workspace-body">
        {/* ─── Left: Code Editor (55%) ─── */}
        <div className="voice-workspace-left" style={{ width: leftWidth, flex: "none" }}>
          {/* Flashy canvas overlay when files update */}
          <AnimatePresence>
            {showCanvas && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 25 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 5,
                  pointerEvents: "auto",
                }}
              >
                <FlashyCodeCanvas />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Full editor workspace always mounted underneath */}
          <EditorWorkspace />
        </div>

        {/* ─── Resize divider ─── */}
        <div className="voice-workspace-divider" onMouseDown={handleDividerDrag} />

        {/* ─── Right: Socratic Conversation (45%) ─── */}
        <div className="voice-workspace-right" style={{ width: rightWidth, flex: "none" }}>
          {/* Chat panel fills remaining space */}
          <SocraticChat orbState={orbState} setOrbState={setOrbState} />
        </div>
      </div>

      {/* ─── Bottom: Terminal drawer ─── */}
      <LocalLinkTerminal />
    </div>
  );
}
