/**
 * AgentPanel — Chat-like interface to the autonomous Planner/Coder/Reflector agent loop.
 * Shows agent messages, diffs, pipeline status, and accepts user goals.
 */

"use client";

import { useState, useRef, useEffect } from "react";
import { useAgentStore, type AgentNodeId, type AgentMessage } from "@/store/agent-store";
import { useRepoStore } from "@/store/repo-store";

// ── Node labels ──────────────────────────────────────────────────────────────

const NODE_LABELS: Record<AgentNodeId, { icon: string; label: string; color: string }> = {
  idle: { icon: "⏸", label: "Idle", color: "var(--ash)" },
  planning: { icon: "🧠", label: "Planning", color: "var(--saffron)" },
  searching: { icon: "🔍", label: "Searching", color: "var(--lime)" },
  editing: { icon: "⚡", label: "Editing", color: "var(--sprout)" },
  reflecting: { icon: "🔬", label: "Reflecting", color: "#8ec8e8" },
  applying: { icon: "✏️", label: "Applying", color: "var(--lime)" },
  done: { icon: "✅", label: "Done", color: "var(--sprout)" },
  error: { icon: "❌", label: "Error", color: "var(--terracotta)" },
};

// ── Markdown-like rendering ──────────────────────────────────────────────────

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  return lines.map((line, i) => {
    // Bold
    const parts = line.split(/\*\*(.+?)\*\*/g);
    const rendered = parts.map((p, k) =>
      k % 2 === 1 ? (
        <strong key={k} style={{ color: "var(--lime)", fontWeight: 600 }}>{p}</strong>
      ) : (
        <span key={k}>
          {/* Inline code */}
          {p.split(/`([^`]+)`/g).map((seg, j) =>
            j % 2 === 1 ? (
              <code key={j} className="agent-inline-code">{seg}</code>
            ) : (
              <span key={j}>{seg}</span>
            ),
          )}
        </span>
      ),
    );
    return (
      <div key={i} style={{ minHeight: line.trim() ? undefined : "0.3em" }}>
        {rendered}
      </div>
    );
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AgentPanel() {
  const {
    running,
    currentNode,
    messages,
    totalEdits,
    totalDiffs,
    tokensUsed,
    runAgent,
    stopAgent,
    clearHistory,
  } = useAgentStore();

  const loadRepo = useRepoStore((s) => s.loadRepo);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || running) return;
    const goal = input.trim();
    setInput("");
    await runAgent(goal);
    // Reload the repo file list after agent finishes
    await loadRepo();
  };

  const nodeInfo = NODE_LABELS[currentNode];

  return (
    <div className="agent-panel">
      {/* Header */}
      <div className="agent-panel-header">
        <div className="agent-panel-title">
          <span className="panel-title">Agent <span className="accent">Loop</span></span>
          <span
            className="agent-status-badge"
            style={{ background: `${nodeInfo.color}22`, color: nodeInfo.color, borderColor: `${nodeInfo.color}44` }}
          >
            {nodeInfo.icon} {nodeInfo.label}
          </span>
        </div>
        <div className="agent-panel-stats">
          <span className="agent-stat">{totalEdits} edits</span>
          <span className="agent-stat">{totalDiffs} diffs</span>
          <span className="agent-stat">{tokensUsed} tok</span>
          {messages.length > 0 && (
            <button className="agent-clear-btn" onClick={clearHistory} title="Clear history">
              🗑
            </button>
          )}
        </div>
      </div>

      {/* Pipeline visualization */}
      <div className="agent-pipeline-bar">
        {(["planning", "searching", "editing", "reflecting", "applying", "done"] as AgentNodeId[]).map((node) => {
          const info = NODE_LABELS[node];
          const isActive = currentNode === node;
          const isDone =
            currentNode === "done" ||
            (["planning", "searching", "editing", "reflecting", "applying", "done"].indexOf(currentNode) >
              ["planning", "searching", "editing", "reflecting", "applying", "done"].indexOf(node));
          return (
            <div
              key={node}
              className={`agent-pipeline-step ${isActive ? "active" : ""} ${isDone ? "done" : ""}`}
              title={info.label}
            >
              <span className="agent-pipeline-icon">{info.icon}</span>
              <span className="agent-pipeline-label">{info.label}</span>
            </div>
          );
        })}
      </div>

      {/* Messages */}
      <div className="agent-messages">
        {messages.length === 0 && (
          <div className="agent-empty">
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem" }}>🌿</div>
            <div className="agent-empty-title">VRIKSHA Agent</div>
            <div className="agent-empty-sub">
              Enter a goal below. The agent will autonomously plan, search, edit code with surgical diffs, and verify the output.
            </div>
            <div className="agent-chips">
              {[
                "Build e-commerce API",
                "Make DB highly available",
                "Generate Terraform for VPC",
                "Refactor codebase",
                "Add unit tests",
              ].map((chip) => (
                <button
                  key={chip}
                  className="agent-chip"
                  onClick={() => setInput(chip)}
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {running && (
          <div className="agent-typing">
            <div className="typing-indicator">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
            <span className="agent-typing-label">{nodeInfo.label}…</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="agent-input-area">
        <div className="agent-input-row">
          <textarea
            className="agent-text-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe what you want to build or change…"
            rows={1}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={running}
          />
          {running ? (
            <button className="agent-stop-btn" onClick={stopAgent}>
              ⏹ Stop
            </button>
          ) : (
            <button
              className="agent-send-btn"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              ▶ Run
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`agent-msg ${message.role}`}>
      <div className="agent-msg-avatar">
        {isUser ? "👤" : isSystem ? "⚙️" : "🌿"}
      </div>
      <div className="agent-msg-content">
        <div className={`agent-msg-bubble ${message.role}`}>
          {renderMarkdown(message.text)}
        </div>
        <div className="agent-msg-meta">
          {isUser ? "You" : isSystem ? "System" : "VRIKSHA Agent"}
          {" · "}
          {new Date(message.timestamp).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {message.node && !isUser && (
            <span className="agent-msg-node">
              {NODE_LABELS[message.node]?.icon} {NODE_LABELS[message.node]?.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
