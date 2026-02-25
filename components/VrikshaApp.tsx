"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Header from './Header';
import PipelineSidebar from './PipelineSidebar';
import ChatPanel from './ChatPanel';
import CodeOutputPanel from './CodeOutputPanel';
import { AI_RESPONSES, PIPELINE_NODES } from '../lib/data';

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function VrikshaApp() {
  const [showWelcome, setShowWelcome] = useState(true);
  const [lang, setLang] = useState("en");
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [recording, setRecording] = useState(false);
  const [activeTab, setActiveTab] = useState("main.tf");
  const [nodes, setNodes] = useState(PIPELINE_NODES);
  const [tokenUsed, setTokenUsed] = useState(12);
  const [stats, setStats] = useState({ files: 0, lines: 0, tokens: 847, sessions: 1 });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const advancePipeline = useCallback((to: number) => {
    setNodes(prev => prev.map(n => ({
      ...n,
      state: n.id < to ? "done" : n.id === to ? "active" : "waiting"
    })));
  }, []);

  const addMessage = useCallback((role: string, text: string, delay = 0) => {
    return new Promise<void>(resolve => {
      setTimeout(() => {
        setMessages(prev => [...prev, {
          role,
          text,
          time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
        }]);
        resolve();
      }, delay);
    });
  }, []);

  const handleStart = () => {
    setShowWelcome(false);
    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      const greeting = lang === "hi" ? AI_RESPONSES.greeting.hi
        : lang === "ta" ? AI_RESPONSES.greeting.ta
        : AI_RESPONSES.greeting.en;
      addMessage("ai", greeting);
      advancePipeline(2);
    }, 1200);
  };

  const handleSend = async (text = input) => {
    if (!text.trim()) return;
    const msg = text.trim();
    setInput("");
    await addMessage("user", msg);
    setIsTyping(true);
    setTokenUsed(t => Math.min(t + Math.floor(msg.length / 4), 100));

    let response = AI_RESPONSES.deploy;
    let delay = 1800;
    let nextNode = 3;

    const lower = msg.toLowerCase();
    if (lower.includes("ecommerce") || lower.includes("e-commerce") || lower.includes("shop") || lower.includes("store")) {
      response = AI_RESPONSES.ecommerce; nextNode = 2;
    } else if (lower.includes("database") || lower.includes("dynamo") || lower.includes("highly available") || lower.includes("replica")) {
      response = AI_RESPONSES.database; nextNode = 3;
      setActiveTab("dynamodb.tf");
      delay = 1400;
    } else if (lower.includes("deploy") || lower.includes("generate") || lower.includes("build") || lower.includes("create")) {
      response = AI_RESPONSES.deploy; nextNode = 4;
      setStats(s => ({ ...s, files: 4, lines: 87 }));
    }

    setTimeout(() => {
      setIsTyping(false);
      addMessage("ai", response);
      advancePipeline(nextNode);
      setStats(s => ({ ...s, tokens: s.tokens + Math.floor(response.length / 4) }));
    }, delay);
  };

  const handleChip = (chip: string) => {
    setInput(chip);
  };

  const toggleRecording = () => {
    setRecording(r => !r);
    if (!recording) {
      setTimeout(() => {
        setRecording(false);
        setInput("Make my database highly available across multiple regions");
      }, 2500);
    }
  };

  return (
    <div className="app">
      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <div key={i} className="particle" style={{
          left: `${10 + i * 15}%`,
          animationDelay: `${i * 1.3}s`,
          animationDuration: `${7 + i}s`
        }} />
      ))}

      <Header lang={lang} setLang={setLang} />

      {/* Main 3-column layout */}
      <main className="main">
        <PipelineSidebar nodes={nodes} stats={stats} tokenUsed={tokenUsed} lang={lang} />

        <ChatPanel
          showWelcome={showWelcome}
          lang={lang}
          messages={messages}
          isTyping={isTyping}
          input={input}
          setInput={setInput}
          recording={recording}
          handleStart={handleStart}
          handleSend={handleSend}
          toggleRecording={toggleRecording}
          handleChip={handleChip}
        />

        <CodeOutputPanel activeTab={activeTab} setActiveTab={setActiveTab} stats={stats} lang={lang} />
      </main>
    </div>
  );
}