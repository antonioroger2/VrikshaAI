"use client";

import { useState } from 'react';
import { CODE_FILES } from '../lib/codeFiles';
import DiffBlock from './DiffBlock';

interface CodeOutputPanelProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  stats: { files: number; lines: number; tokens: number; sessions: number };
  lang: string;
}

const CodeOutputPanel = ({ activeTab, setActiveTab, stats, lang }: CodeOutputPanelProps) => {
  const [copiedFile, setCopiedFile] = useState<string | null>(null);

  const handleCopy = (file: string) => {
    navigator.clipboard?.writeText(CODE_FILES[file as keyof typeof CODE_FILES] || "");
    setCopiedFile(file);
    setTimeout(() => setCopiedFile(null), 2000);
  };

  const currentCode = CODE_FILES[activeTab as keyof typeof CODE_FILES] || "";

  return (
    <aside className="panel">
      <div className="panel-header">
        <span className="panel-title">Generated <span className="accent">Codebase</span></span>
        <span className="tag tag-blue">{stats.lines} lines</span>
      </div>

      <div className="code-tabs">
        {Object.keys(CODE_FILES).map(f => (
          <button
            key={f}
            className={`code-tab ${activeTab === f ? "active" : ""}`}
            onClick={() => setActiveTab(f)}
          >
            {f === "diff-patch" ? "📋 diff" : `📄 ${f}`}
          </button>
        ))}
      </div>

      <div className="panel-body">
        <div className="code-file-label">
          <div className="file-dot" style={{
            background: activeTab.endsWith(".tf") ? "var(--saffron)"
              : activeTab === "diff-patch" ? "var(--terracotta)"
              : "var(--sprout)"
          }} />
          {activeTab === "diff-patch" ? "AST Unified Diff Patch" : `Terraform IaC · ${activeTab}`}
          {activeTab === "dynamodb.tf" && <span className="tag tag-green" style={{ marginLeft: 4 }}>AST-patched</span>}
        </div>

        <div className="code-block">
          <button className="copy-btn" onClick={() => handleCopy(activeTab)}>
            {copiedFile === activeTab ? "✓ copied" : "copy"}
          </button>
          {activeTab === "diff-patch"
            ? <DiffBlock code={currentCode} />
            : <pre>{currentCode}</pre>
          }
        </div>

        {activeTab === "dynamodb.tf" && (
          <div className="samjhao-block">
            <div className="samjhao-title">Samjhao · डेटाबेस क्यों?</div>
            <div className="samjhao-text" style={{ fontSize: "0.7rem" }}>
              {lang === "hi"
                ? "DynamoDB में replica जोड़ने से — अगर एक region बंद हो जाए, दूसरे में data safe रहता है। जैसे गाँव में backup store।"
                : "Adding a DynamoDB replica across regions means if Mumbai (ap-south-1) goes down, Ohio (us-east-2) keeps serving your users. Your data never disappears."}
            </div>
          </div>
        )}

        <hr className="section-divider" />

        <div style={{ fontSize: "0.65rem", color: "var(--ash)", lineHeight: 1.7 }}>
          <div style={{ marginBottom: "0.4rem", color: "var(--lime)", fontFamily: "Syne, sans-serif", fontWeight: 700 }}>
            Well-Architected Checks
          </div>
          {[
            ["✓", "green", "Operational Excellence"],
            ["✓", "green", "Security — IAM least-privilege"],
            ["✓", "green", "Reliability — Multi-AZ"],
            ["⚡", "orange", "Performance — Pending review"],
            ["○", "ash", "Cost Optimization — Calculating"],
          ].map(([icon, color, label]) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ color: `var(--${color})` }}>{icon}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

export default CodeOutputPanel;