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
import { translateChatMessage } from "@/lib/translation-service";
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

  // Translation logic removed because messages are natively generated in target language.

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {/* Custom Indian Flag Eye SVG */}
            <svg width="36" height="36" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="28" stroke="#f5a623" strokeWidth="4" />
              <circle cx="50" cy="50" r="20" stroke="#ffffff" strokeWidth="4" />
              <circle cx="50" cy="50" r="12" stroke="#138808" strokeWidth="4" fill="#000080" />
              <path d="M50 8 L50 18 M92 50 L82 50 M50 92 L50 82 M8 50 L18 50" stroke="#f5a623" strokeWidth="4" strokeLinecap="round" />
              <path d="M20 20 L28 28 M80 20 L72 28 M80 80 L72 72 M20 80 L28 72" stroke="#4caf50" strokeWidth="4" strokeLinecap="round" />
            </svg>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <span className="vw-chat-title" style={{ fontSize: '1.4rem', letterSpacing: '0', textTransform: 'none', lineHeight: 1 }}>
                <span style={{ color: '#f5a623' }}>भारत</span>
                <span style={{ color: '#4caf50' }}>-AGENT</span>
              </span>
              <span style={{ fontSize: '0.65rem', color: '#a0aec0', letterSpacing: '0.05em' }}>
                Voice-First AI System Architect
              </span>
            </div>
          </div>
          {running && <span className="vw-running-badge">Processing</span>}
        </div>
        <div className="vw-chat-header-right">
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
            className="vw-clear-chat-btn"
            onClick={clearHistory}
            title="Clear all messages"
            disabled={messages.length === 0}
          >
            <Trash2 size={14} />
            <span className="vw-clear-text">Clear Chat</span>
          </button>

          {running && (
            <button className="vw-stop-btn" onClick={stopAgent}>
              <Square size={13} />
              <span>Stop</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="vw-messages-area">
        {messages.length === 0 && (
          <motion.div
            className="vw-empty-state-new"
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            {/* Language Selection Grid */}
            <div className="vw-lang-section">
              <div className="vw-lang-section-title">
                <Languages size={18} /> CHOOSE YOUR LANGUAGE
              </div>
              <div className="vw-lang-section-sub">
                I will understand and respond in your language
              </div>
              <div className="vw-lang-grid">
                {(Object.keys(SUPPORTED_LANGUAGES) as SupportedLanguage[]).map((key) => {
                  const lang = SUPPORTED_LANGUAGES[key];
                  return (
                    <div 
                      key={key} 
                      className={`vw-lang-card ${inputLanguage === key ? 'active' : ''}`}
                      onClick={() => {
                        setInputLanguage(key);
                        setTtsLanguage(key);
                      }}
                    >
                      {key === 'en' ? (
                        <div className="vw-lang-card-flag">🇬🇧</div>
                      ) : (
                        <div className="vw-lang-card-flag">🇮🇳</div>
                      )}
                      <div className="vw-lang-card-native">{lang.nativeName}</div>
                      <div className="vw-lang-card-english">{lang.name}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sample Prompts / Chips */}
            <div className="vw-chips-section" style={{ padding: '0 1.5rem 2rem' }}>
              <div className="vw-chips">
                {CHIPS.map((chip) => (
                  <button key={chip} className="vw-chip" onClick={() => setInput(chip)}>
                    {chip}
                  </button>
                ))}
              </div>
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
