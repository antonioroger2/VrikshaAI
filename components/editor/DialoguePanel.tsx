"use client";

import { useState } from "react";
import SocraticChat from "@/components/voice/SocraticChat";
import type { OrbState } from "@/components/voice/VoiceOrb";

/**
 * DialoguePanel — editor-side host for the shared Socratic dialogue UI.
 * Keeps the same agent loop/store behavior while replacing the old AgentPanel UI.
 */
export default function DialoguePanel() {
  const [orbState, setOrbState] = useState<OrbState>("idle");

  return (
    <div className="editor-dialogue-panel">
      <SocraticChat orbState={orbState} setOrbState={setOrbState} />
    </div>
  );
}
