"use client";

import { useRef } from 'react';
import { HINT_CHIPS } from '../lib/data';

interface Message {
  role: 'ai' | 'user';
  text: string;
  time: string;
}

interface ChatPanelProps {
  showWelcome: boolean;
  lang: string;
  messages: Message[];
  isTyping: boolean;
  input: string;
  setInput: (input: string) => void;
  recording: boolean;
  handleStart: () => void;
  handleSend: (text?: string) => void;
  toggleRecording: () => void;
  handleChip: (chip: string) => void;
}

const ChatPanel = ({
  showWelcome,
  lang,
  messages,
  isTyping,
  input,
  setInput,
  recording,
  handleStart,
  handleSend,
  toggleRecording,
  handleChip
}: ChatPanelProps) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="chat-panel" style={{ position: "relative" }}>
      {showWelcome && (
        <div className="welcome-overlay">
          <svg viewBox="0 0 42 42" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width: '60px', height: '60px' }}>
            <rect x="18" y="28" width="6" height="10" rx="2" fill="#4a2d0a"/>
            <polygon points="21,4 8,24 34,24" fill="#2d6a2f"/>
            <polygon points="21,10 10,27 32,27" fill="#4caf50" opacity="0.8"/>
            <polygon points="21,16 12,30 30,30" fill="#a8e063" opacity="0.6"/>
            <circle cx="21" cy="8" r="2" fill="#f5a623" opacity="0.9"/>
          </svg>
          <div className="welcome-title">वृक्ष जैसी<br/>Architecture</div>
          <div className="welcome-sub">
            Talk to VRIKSHA in Hindi, Tamil, Telugu or English.<br />
            It interviews you, thinks like a senior architect, and generates production-ready AWS code — one surgical diff at a time.
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
            <span className="tag tag-green">AI4Bharat ASR</span>
            <span className="tag tag-orange">Bedrock</span>
            <span className="tag tag-blue">Tree-sitter AST</span>
            <span className="tag tag-green">Qwen Coder</span>
          </div>
          <button className="start-btn" onClick={handleStart}>
            🌱 Begin Building
          </button>
        </div>
      )}

      <div className="panel-header" style={{ background: "rgba(13,20,10,0.9)" }}>
        <span className="panel-title">Socratic <span className="accent">Conversation</span></span>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {recording && (
            <div className="waveform">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="wave-bar" style={{
                  animationDelay: `${i * 0.08}s`,
                  animationDuration: `${0.4 + Math.random() * 0.3}s`
                }} />
              ))}
            </div>
          )}
          <span className="tag tag-orange">{lang.toUpperCase()}</span>
        </div>
      </div>

      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`msg ${msg.role}`}>
            <div className="msg-avatar">
              {msg.role === "ai" ? "🌿" : "👤"}
            </div>
            <div>
              <div className="msg-bubble">
                {msg.text.split("\n").map((line, j) => {
                  // Bold markdown
                  const parts = line.split(/\*\*(.+?)\*\*/g);
                  return (
                    <div key={j}>
                      {parts.map((p, k) => k % 2 === 1
                        ? <strong key={k} style={{ color: "var(--lime)", fontWeight: 600 }}>{p}</strong>
                        : <span key={k}>{p}</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="msg-meta">{msg.role === "ai" ? "VRIKSHA" : "You"} · {msg.time}</div>
            </div>
          </div>
        ))}

        {isTyping && (
          <div className="msg ai">
            <div className="msg-avatar">🌿</div>
            <div>
              <div className="typing-indicator">
                <div className="typing-dot" />
                <div className="typing-dot" />
                <div className="typing-dot" />
              </div>
              <div className="msg-meta" style={{ marginTop: 4 }}>VRIKSHA is thinking…</div>
            </div>
          </div>
        )}
      </div>

      <div className="input-area">
        <div className="input-row">
          <button
            className={`icon-btn ${recording ? "recording" : ""}`}
            onClick={toggleRecording}
            title={recording ? "Stop recording" : "Speak in Hindi/Tamil/Telugu"}
          >
            {recording ? "⏹" : "🎙️"}
          </button>
          <textarea
            ref={inputRef}
            className="text-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={
              lang === "hi" ? "आप क्या बनाना चाहते हैं? बोलिए या लिखिए…"
              : lang === "ta" ? "நீங்கள் என்ன கட்ட விரும்புகிறீர்கள்?"
              : "Describe your system, ask a question, or request a code change…"
            }
            rows={1}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
          />
          <button className="send-btn" onClick={() => handleSend()} disabled={!input.trim() || isTyping}>
            ➤
          </button>
        </div>
        <div className="input-hints">
          {HINT_CHIPS.map(c => (
            <span key={c} className="hint-chip" onClick={() => handleChip(c)}>{c}</span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;