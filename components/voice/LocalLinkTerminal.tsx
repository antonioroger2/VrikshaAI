/**
 * LocalLinkTerminal — Glassmorphic terminal drawer fixed to the bottom.
 *
 * Features:
 *  - Expandable/collapsible drawer (spring animation)
 *  - "Connect to Localhost Bash" toggle → toast notification
 *  - Sandbox command interpreter (ls, pwd, echo, help)
 *  - "Export & Deploy" glowing button with zip animation
 *  - macOS-style traffic light dots in the title bar
 */
"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Folder, Lock, Package } from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface TerminalLine {
  id: number;
  type: "output" | "input" | "system" | "error";
  text: string;
}

// ── Sandbox command evaluator ────────────────────────────────────────────────

function sandboxEval(cmd: string): string {
  const c = cmd.trim().toLowerCase();
  if (!c) return "";
  if (c === "help")
    return "Commands: ls  pwd  echo <text>  clear  date  whoami  uname";
  if (c === "ls") return "app/  components/  lib/  public/  store/  styles/  package.json  next.config.ts";
  if (c === "pwd") return "/workspace/vriksha";
  if (c === "date") return new Date().toString();
  if (c === "whoami") return "vriksha-dev";
  if (c === "uname") return "VrikshaOS 1.0 (sandbox)";
  if (c.startsWith("echo ")) return cmd.trim().slice(5);
  if (c === "clear") return "__clear__";
  return `bash: ${cmd}: command not found  (sandbox mode — real bash is coming soon)`;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LocalLinkTerminal() {
  const [open, setOpen] = useState(false);
  const [bashConnected, setBashConnected] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>([
    { id: 0, type: "system", text: "VRIKSHA Local-Link Terminal v1.0 — Sandbox Mode" },
    { id: 1, type: "output", text: 'Type "help" for available sandbox commands.' },
  ]);
  const [cmd, setCmd] = useState("");
  const lineCounter = useRef(2);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll terminal body
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [lines, open]);

  const showToast = (msg: string, duration = 4500) => {
    setToast(msg);
    setTimeout(() => setToast(null), duration);
  };

  const handleBashToggle = () => {
    const next = !bashConnected;
    setBashConnected(next);
    showToast(
      next
        ? "⚠️ Local bash execution is an upcoming feature. Terminal running in sandbox mode."
        : "Disconnected. Terminal remains in sandbox mode."
    );
  };

  const handleDeploy = () => {
    if (deploying) return;
    setDeploying(true);
    showToast("Zipping files… Export & Deploy is coming soon! Stay tuned.", 4000);
    // Add terminal flavour lines
    const addLine = (text: string, type: TerminalLine["type"] = "output") => {
      setLines((prev) => [
        ...prev,
        { id: lineCounter.current++, type, text },
      ]);
    };
    setOpen(true);
    addLine("$ vriksha export --target=vercel", "input");
    setTimeout(() => addLine("  Collecting files…"), 600);
    setTimeout(() => addLine("  Validating environment…"), 1200);
    setTimeout(() => addLine("  Building production bundle…"), 2000);
    setTimeout(() => {
      addLine("  Done! (sandbox — no real deploy occurred)", "system");
      setDeploying(false);
    }, 3000);
  };

  const handleCmd = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    const input = cmd.trim();
    if (!input) return;
    setCmd("");
    const response = sandboxEval(input);
    if (response === "__clear__") {
      setLines([{ id: lineCounter.current++, type: "system", text: "Terminal cleared." }]);
      return;
    }
    setLines((prev) => [
      ...prev,
      { id: lineCounter.current++, type: "input", text: `$ ${input}` },
      ...(response ? [{ id: lineCounter.current++, type: "output" as const, text: response }] : []),
    ]);
  };

  return (
    <div className="vw-terminal-wrapper">
      {/* Toggle handle */}
      <button
        className="vw-terminal-toggle"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-label="Toggle terminal"
      >
        <span className="vw-terminal-toggle-arrow">{open ? "▼" : "▲"}</span>
        <span>Local-Link Terminal</span>
        <span
          className={`vw-bash-dot ${bashConnected ? "vw-bash-dot--connected" : ""}`}
          title={bashConnected ? "Sandbox connected" : "Disconnected"}
        />
      </button>

      {/* Drawer */}
      <AnimatePresence>
        {open && (
          <motion.div
            className="vw-terminal-drawer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 300, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
          >
            {/* Title bar */}
            <div className="vw-terminal-titlebar">
              {/* macOS traffic lights */}
              <div className="vw-traffic-lights">
                <span style={{ background: "#ff5f57" }} />
                <span style={{ background: "#febc2e" }} />
                <span style={{ background: "#28c840" }} />
              </div>

              <span className="vw-terminal-title">
                bash — {bashConnected ? "sandbox" : "disconnected"}
              </span>

              <div className="vw-terminal-actions">
                {/* Bash connect toggle */}
                <label className="vw-bash-toggle-label" title="Connect to local bash">
                  <input
                    type="checkbox"
                    checked={bashConnected}
                    onChange={handleBashToggle}
                  />
                  <span className="vw-toggle-slider" />
                  <span className="vw-toggle-label-sm">
                    {bashConnected ? "Sandbox" : "Connect Bash"}
                  </span>
                </label>

                {/* Deploy button */}
                <motion.button
                  className={`vw-deploy-btn ${deploying ? "vw-deploy-btn--deploying" : ""}`}
                  onClick={handleDeploy}
                  animate={
                    deploying
                      ? {
                          boxShadow: [
                            "0 0 8px rgba(76,175,80,0.5)",
                            "0 0 28px rgba(76,175,80,0.9)",
                            "0 0 8px rgba(76,175,80,0.5)",
                          ],
                        }
                      : {}
                  }
                  transition={deploying ? { duration: 0.9, repeat: Infinity } : {}}
                  disabled={deploying}
                >
                  {deploying ? "Packaging…" : "Export & Deploy"}
                </motion.button>
              </div>
            </div>

            {/* Terminal body */}
            <div className="vw-terminal-body" ref={bodyRef}>
              {lines.map((line) => (
                <div
                  key={line.id}
                  className={`vw-terminal-line vw-terminal-line--${line.type}`}
                >
                  {line.text}
                </div>
              ))}

              {/* Active input row */}
              <div className="vw-terminal-input-row">
                <span className="vw-terminal-prompt">$</span>
                <input
                  className="vw-terminal-input"
                  value={cmd}
                  onChange={(e) => setCmd(e.target.value)}
                  onKeyDown={handleCmd}
                  placeholder="Type a command…"
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                />
                <span className="vw-cursor-blink" aria-hidden="true">▋</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            className="vw-toast"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 14 }}
            transition={{ duration: 0.25 }}
            role="status"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
