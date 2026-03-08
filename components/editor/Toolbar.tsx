/**
 * Toolbar — Top toolbar with project actions: import, export, clear, search toggle.
 */

"use client";

import { useRef, useState } from "react";
import {
  Compass,
  Download,
  FileJson,
  FolderOpen,
  Mic,
  Play,
  Search,
  Square,
  Trash2,
  Upload,
} from "lucide-react";
import { useRepoStore } from "@/store/repo-store";
import { buildSearchIndex } from "@/lib/search-engine";
import TreeLogo from "@/components/TreeLogo";
import { createVoiceInputController } from "@/lib/voice-input";

interface ToolbarProps {
  activePanel: "files" | "search";
  setActivePanel: (panel: "files" | "search") => void;
}

export default function Toolbar({ activePanel, setActivePanel }: ToolbarProps) {
  const { files, importFiles, clearAll, loadRepo, createFile } = useRepoStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const voiceControllerRef = useRef<any>(null);

  // Handle voice recording
  const handleVoiceClick = async () => {
    if (voiceRecording) {
      // Stop recording and process
      if (voiceControllerRef.current) {
        try {
          const blob = await voiceControllerRef.current.stopAndTranscribe();
          setVoiceRecording(false);
          // Process the Tamil workflow
          const { processTamilVoiceWorkflow } = await import('@/lib/voice-input');
          const result = await processTamilVoiceWorkflow(blob);
          // Play audio
          const audio = new Audio(URL.createObjectURL(result.audioBlob));
          audio.play();
          alert(`Response: ${result.text}`);
        } catch (error) {
          alert(`Voice processing error: ${error}`);
        }
      }
    } else {
      // Start recording
      try {
        const { createVoiceInputController } = await import('@/lib/voice-input');
        voiceControllerRef.current = createVoiceInputController();
        await voiceControllerRef.current.start('ta'); // Start in Tamil
        setVoiceRecording(true);
      } catch (error) {
        alert(`Voice recording error: ${error}`);
      }
    }
  };

  // Import files from a folder or zip via <input type="file">
  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputFiles = e.target.files;
    if (!inputFiles || inputFiles.length === 0) return;

    setImporting(true);
    const fileMap: Record<string, string> = {};

    for (let i = 0; i < inputFiles.length; i++) {
      const file = inputFiles[i];
      // Use webkitRelativePath if available (folder upload), otherwise just name
      const path = (file as { webkitRelativePath?: string }).webkitRelativePath || file.name;
      try {
        const text = await file.text();
        fileMap[path] = text;
      } catch {
        // Skip binary files
      }
    }

    await importFiles(fileMap);
    await buildSearchIndex();
    setImporting(false);

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Export all files as a downloadable JSON
  const handleExport = async () => {
    const { readFile } = await import("@/lib/repo-db");
    const allFiles = await import("@/lib/repo-db").then((m) => m.listFiles());

    const fileMap: Record<string, string> = {};
    for (const path of await allFiles) {
      const content = await readFile(path);
      if (content !== undefined) fileMap[path] = content;
    }

    const blob = new Blob([JSON.stringify(fileMap, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vriksha-repo-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import from JSON export
  const handleImportJson = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const text = await file.text();
      const fileMap = JSON.parse(text) as Record<string, string>;
      await importFiles(fileMap);
      await buildSearchIndex();
    };
    input.click();
  };

  // Load demo project
  const handleLoadDemo = async () => {
    const { CODE_FILES } = await import("@/lib/codeFiles");
    await importFiles(CODE_FILES);
    await buildSearchIndex();
  };

  const handleClear = async () => {
    if (!confirm("Clear all files in the repo? This cannot be undone.")) return;
    await clearAll();
    await buildSearchIndex();
  };

  const handleReplayTour = () => {
    window.dispatchEvent(new Event('replay-tour'));
  };

  return (
    <header className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-logo">
          <TreeLogo />
          <div>
            <div className="toolbar-logo-name">VRIKSHA<span>.ai</span></div>
            <div className="toolbar-logo-sub">Local Editor</div>
          </div>
        </div>

        <div className="toolbar-nav">
          <button
            className={`toolbar-nav-btn ${activePanel === "files" ? "active" : ""}`}
            onClick={() => setActivePanel("files")}
            title="File Explorer"
          >
            <FolderOpen size={14} />
            <span>Files</span>
          </button>
          <button
            className={`toolbar-nav-btn ${activePanel === "search" ? "active" : ""}`}
            onClick={() => setActivePanel("search")}
            title="Search"
          >
            <Search size={14} />
            <span>Search</span>
          </button>
        </div>
      </div>

      <div className="toolbar-right">
        <span className="toolbar-file-count">{files.length} files</span>

        <button className="toolbar-btn" onClick={handleLoadDemo} title="Load demo project">
          <Play size={14} />
          <span>Demo</span>
        </button>

        <div className="toolbar-separator" />

        <button className="toolbar-btn" onClick={handleImportClick} disabled={importing}>
          <Upload size={14} />
          <span>{importing ? "Importing" : "Import"}</span>
        </button>
        <button className="toolbar-btn" onClick={handleImportJson}>
          <FileJson size={14} />
          <span>JSON</span>
        </button>
        <button className="toolbar-btn" onClick={handleExport}>
          <Download size={14} />
          <span>Export</span>
        </button>

        <div className="toolbar-separator" />

        <button className="toolbar-btn danger" onClick={handleClear}>
          <Trash2 size={14} />
          <span>Clear</span>
        </button>

        <div className="toolbar-separator" />

        <button
          className={`toolbar-btn ${voiceRecording ? 'recording' : ''}`}
          onClick={handleVoiceClick}
          title="Voice Input"
        >
          {voiceRecording ? <Square size={14} /> : <Mic size={14} />}
        </button>

        <div className="toolbar-separator" />

        <button className="toolbar-btn" onClick={handleReplayTour} title="Replay first-run walkthrough">
          <Compass size={14} />
          <span>Tour</span>
        </button>
      </div>
    </header>
  );
}
