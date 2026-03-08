/**
 * SocraticChat — The main voice-first conversation panel.
 *
 * Features:
 *  - Chat bubbles with AnimatePresence spring entry
 *  - Play Audio button on every AI message
 *  - Auto-TTS toggle (reads AI responses aloud via Web Speech API)
 *  - Language-aware TTS (hi-IN, ta-IN, te-IN, …)
 *  - Mic button → startRecording + transcribeAudio from voice-input.ts
 *  - Sends transcribed text to useAgentStore.runAgent()
 */
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Bot, Languages, Mic, Square, Trash2, Volume2 } from "lucide-react";
import { useAgentStore, type AgentMessage } from "@/store/agent-store";
import { useRepoStore } from "@/store/repo-store";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/api-config";
import {
  startRecording,
  isVoiceInputSupported,
  transcribeAudio,
  type RecordingHandle,
} from "@/lib/voice-input";
import type { OrbState } from "./VoiceOrb";

// ── Language → BCP-47 TTS voice tag ─────────────────────────────────────────

const TTS_LANG: Record<SupportedLanguage, string> = {
  en: "en-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  te: "te-IN",
  bn: "bn-IN",
  mr: "mr-IN",
  gu: "gu-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  pa: "pa-IN",
  or: "or-IN",
};

interface Props {
  orbState: OrbState;
  setOrbState: (s: OrbState) => void;
}

// ── Simple markdown-aware text renderer ─────────────────────────────────────

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <div key={i} style={{ minHeight: line.trim() ? undefined : "0.4em" }}>
            {parts.map((p, k) =>
              k % 2 === 1 ? (
                <strong key={k} style={{ color: "var(--lime)" }}>{p}</strong>
              ) : (
                <span key={k}>
                  {p.split(/`([^`]+)`/g).map((seg, j) =>
                    j % 2 === 1 ? (
                      <code key={j} className="vw-inline-code">{seg}</code>
                    ) : (
                      <span key={j}>{seg}</span>
                    )
                  )}
                </span>
              )
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Chip suggestions ─────────────────────────────────────────────────────────

const CHIPS = [
  "Build a REST API",
  "Make DB highly available",
  "मुझे React component बनाओ",
  "API ను రూపొందించండి",
  "Add unit tests",
];

const NODE_WAIT_LABEL: Partial<Record<Exclude<AgentMessage["node"], undefined>, string>> = {
  planning: "Planning your request",
  searching: "Exploring project context",
  editing: "Preparing code changes",
  reflecting: "Reviewing solution quality",
  applying: "Applying updates safely",
  responding: "Preparing final response",
};

// ── Component ────────────────────────────────────────────────────────────────

export default function SocraticChat({ orbState, setOrbState }: Props) {
  const {
    messages,
    running,
    currentNode,
    inputLanguage,
    runAgent,
    stopAgent,
    clearHistory,
    setInputLanguage,
  } = useAgentStore();

  const loadRepo = useRepoStore((s) => s.loadRepo);

  const [input, setInput] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [ttsLanguage, setTtsLanguage] = useState<SupportedLanguage>(inputLanguage);
  const [handle, setHandle] = useState<RecordingHandle | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const seenIds = useRef<Set<string>>(new Set());

  // Keep speech output aligned with selected conversation language.
  useEffect(() => {
    setTtsLanguage(inputLanguage);
  }, [inputLanguage]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-TTS — fires whenever a new agent message arrives and autoPlay is on
  useEffect(() => {
    if (!autoPlay) return;
    const newest = messages.filter((m) => m.role === "agent" && !seenIds.current.has(m.id));
    if (newest.length > 0) {
      const last = newest[newest.length - 1];
      seenIds.current.add(last.id);
      playSpeech(last.text, last.id);
    }
    // Mark all as seen regardless of role
    messages.forEach((m) => seenIds.current.add(m.id));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, autoPlay]);

  const playSpeech = useCallback(
    (text: string, id?: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = TTS_LANG[ttsLanguage] ?? "en-US";

      const voices = window.speechSynthesis.getVoices();
      const exactVoice = voices.find((v) => v.lang.toLowerCase() === utter.lang.toLowerCase());
      const familyVoice = voices.find((v) => v.lang.toLowerCase().startsWith(utter.lang.split("-")[0].toLowerCase()));
      const localVoice = [exactVoice, familyVoice].find((v) => v?.localService);
      utter.voice = (localVoice ?? exactVoice ?? familyVoice) || null;

      utter.rate = 1.05;
      if (id) setPlayingId(id);
      setOrbState("speaking");
      utter.onend = () => {
        setPlayingId(null);
        setOrbState("idle");
      };
      utter.onerror = () => {
        setPlayingId(null);
        setOrbState("idle");
      };
      window.speechSynthesis.speak(utter);
    },
    [ttsLanguage, setOrbState]
  );

  const handleSend = useCallback(async () => {
    const goal = input.trim();
    if (!goal || running) return;
    setInput("");
    await runAgent(goal, inputLanguage);
    await loadRepo();
  }, [input, running, runAgent, inputLanguage, loadRepo]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleMicClick = useCallback(async () => {
    if (handle) {
      // Stop and transcribe
      try {
        const blob = await handle.stop();
        setHandle(null);
        setOrbState("idle");
        setTranscribing(true);
        const result = await transcribeAudio(blob, inputLanguage);
        setInput(result.text);
      } catch {
        setInput("");
      } finally {
        setTranscribing(false);
      }
    } else {
      if (!isVoiceInputSupported()) return;
      try {
        const h = await startRecording(30_000);
        setHandle(h);
        setOrbState("listening");
      } catch {
        /* mic denied */
      }
    }
  }, [handle, inputLanguage, setOrbState]);

  const lastMessage = messages[messages.length - 1];
  const waitingForUserResponse =
    !running &&
    currentNode === "responding" &&
    lastMessage?.role === "agent";

  return (
    <div className="vw-chat-panel">
      {/* ── Header ── */}
      <div className="vw-chat-header">
        <div className="vw-chat-header-left">
          <span className="vw-chat-title">
            {inputLanguage === "hi" ? "भारत-AGENT" :
             inputLanguage === "ta" ? "பாரத்-AGENT" :
             inputLanguage === "te" ? "భారత్-AGENT" :
             "भारत-AGENT"}
          </span>
          {running && <span className="vw-running-badge">Processing</span>}
        </div>
        <div className="vw-chat-header-right">
          {/* TTS Language chooser */}
          <div className="vw-tts-language-chooser">
            <span className="vw-tts-lang-label"><Languages size={13} /></span>
            <select
              className="vw-tts-lang-select"
              value={inputLanguage}
              onChange={(e) => {
                const selected = e.target.value as SupportedLanguage;
                setInputLanguage(selected);
                setTtsLanguage(selected);
              }}
              title="Speech language (voice input and output)"
            >
              {(Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[]).map((key) => (
                <option key={key} value={key}>
                  {SUPPORTED_LANGUAGES[key].name}
                </option>
              ))}
            </select>
          </div>

          {/* Auto-TTS toggle */}
          <label className="vw-autoplay-toggle" title="Auto-play AI responses">
            <input
              type="checkbox"
              checked={autoPlay}
              onChange={(e) => setAutoPlay(e.target.checked)}
            />
            <span className="vw-toggle-slider" />
            <span className="vw-toggle-label">Auto-TTS</span>
          </label>

          <button
            className="vw-clear-btn"
            onClick={clearHistory}
            title="Clear chat"
            disabled={messages.length === 0}
          >
            <Trash2 size={14} />
            <span>Clear Chat</span>
          </button>
          {running && (
            <button className="vw-stop-btn" onClick={stopAgent}>
              <Square size={13} />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Tagline ── */}
      <div className="vw-chat-tagline">
        Voice-First System Architect Buddy... Start Building in your own language
      </div>

      {/* ── Language badge ── */}
      <div className="vw-lang-row">
        <span className="vw-lang-badge">Speech I/O: {SUPPORTED_LANGUAGES[inputLanguage].name}</span>
      </div>

      {/* ── Messages ── */}
      <div className="vw-messages-area">
        {messages.length === 0 && (
          <motion.div
            className="vw-empty-state"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <div className="vw-empty-icon"><Bot size={44} strokeWidth={1.5} /></div>
            <div className="vw-empty-title">Ask VRIKSHA Anything</div>
            <div className="vw-empty-sub">
              Speak or type in Hindi, Tamil, Telugu, or any Indian language.
            </div>
            <div className="vw-chips">
              {CHIPS.map((chip) => (
                <button key={chip} className="vw-chip" onClick={() => setInput(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          </motion.div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              className={`vw-bubble vw-bubble--${msg.role}`}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
            >
              <p className="vw-bubble-role">
                {msg.role === "user" ? "You" : msg.role === "agent" ? "VRIKSHA" : "System"}
              </p>
              <div className="vw-bubble-text">
                <RichText text={msg.text} />
              </div>
              {msg.role === "agent" && (
                <button
                  className={`vw-tts-btn ${playingId === msg.id ? "vw-tts-btn--active" : ""}`}
                  onClick={() => playSpeech(msg.text, msg.id)}
                  title="Play audio"
                >
                  {playingId === msg.id ? <Square size={13} /> : <Volume2 size={13} />}
                  <span>{playingId === msg.id ? "Stop" : "Play Audio"}</span>
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        {running && (
          <motion.div
            className="vw-awaiting-response"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="vw-awaiting-title">Waiting for VRIKSHA response</div>
            <div className="vw-awaiting-sub">
              {NODE_WAIT_LABEL[currentNode] ?? "Working on your request"}
            </div>
          </motion.div>
        )}

        {running && (
          <motion.div
            className="vw-typing-indicator"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <span />
            <span />
            <span />
          </motion.div>
        )}

        {waitingForUserResponse && (
          <motion.div
            className="vw-awaiting-response"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="vw-awaiting-title">Waiting for your response</div>
            <div className="vw-awaiting-sub">Answer the clarifying questions above by typing or using the mic.</div>
          </motion.div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input bar ── */}
      <div className="vw-input-area">
        <button
          className={`vw-mic-btn ${orbState === "listening" ? "vw-mic-btn--active" : ""}`}
          onClick={handleMicClick}
          title={orbState === "listening" ? "Stop recording" : "Start voice input"}
          aria-label="Microphone"
        >
          {orbState === "listening" ? <Square size={22} /> : <Mic size={22} />}
        </button>

        <div className="vw-input-bar">
          <textarea
            className="vw-textarea"
            value={transcribing ? "Transcribing..." : input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your goal, or tap the mic…"
            rows={2}
            disabled={running || transcribing}
          />
          <button
            className="vw-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || running}
            title="Send"
          >
            <ArrowUp size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
