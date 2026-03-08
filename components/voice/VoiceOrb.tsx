/**
 * VoiceOrb — Cinematic animated orb that reflects the agent's voice state.
 * States: idle (breathing), listening (fast pulse), speaking (golden glow).
 */
"use client";

import { motion } from "framer-motion";
import { Bot, Mic, Volume2 } from "lucide-react";

export type OrbState = "idle" | "listening" | "speaking";

interface VoiceOrbProps {
  state: OrbState;
  onClick?: () => void;
}

const RING_COLORS: Record<OrbState, string> = {
  idle: "rgba(76,175,80,0.55)",
  listening: "rgba(76,175,80,0.8)",
  speaking: "rgba(245,166,35,0.7)",
};

const RING_COUNTS = [0, 1, 2, 3];

export default function VoiceOrb({ state, onClick }: VoiceOrbProps) {
  const color = RING_COLORS[state];

  return (
    <div className="vw-orb-container" onClick={onClick} role="button" tabIndex={0} aria-label="Voice orb">
      {/* Pulsing concentric rings */}
      {RING_COUNTS.map((i) => (
        <motion.div
          key={i}
          style={{
            width:  `${150 + i * 52}px`,
            height: `${150 + i * 52}px`,
            borderRadius: "50%",
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            border: `1px solid ${color}`,
            pointerEvents: "none",
          }}
          animate={
            state === "listening"
              ? { scale: [1, 1.55 + i * 0.18, 1], opacity: [0.55, 0.04, 0.55] }
              : state === "speaking"
              ? { scale: [1, 1.28 + i * 0.12, 1], opacity: [0.45, 0.75, 0.45] }
              : { scale: [1, 1.10 + i * 0.06, 1], opacity: [0.22, 0.1, 0.22] }
          }
          transition={{
            duration: state === "listening" ? 0.55 : state === "speaking" ? 1.4 : 3,
            repeat: Infinity,
            delay: i * 0.19,
            ease: "easeInOut",
          }}
        />
      ))}

      {/* Core glow sphere */}
      <motion.div
        className={`vw-orb-core vw-orb-core--${state}`}
        animate={
          state === "listening"
            ? {
                scale: [1, 1.18, 0.95, 1.13, 1],
                boxShadow: [
                  "0 0 40px rgba(76,175,80,0.7)",
                  "0 0 90px rgba(76,175,80,1)",
                  "0 0 40px rgba(76,175,80,0.7)",
                ],
              }
            : state === "speaking"
            ? {
                scale: [1, 1.1, 1],
                boxShadow: [
                  "0 0 40px rgba(245,166,35,0.7)",
                  "0 0 110px rgba(245,166,35,1)",
                  "0 0 40px rgba(245,166,35,0.7)",
                ],
              }
            : {
                scale: [1, 1.05, 1],
                boxShadow: [
                  "0 0 20px rgba(76,175,80,0.25)",
                  "0 0 48px rgba(76,175,80,0.55)",
                  "0 0 20px rgba(76,175,80,0.25)",
                ],
              }
        }
        transition={{
          duration: state === "listening" ? 0.5 : state === "speaking" ? 1.5 : 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
      >
        <span className="vw-orb-icon" aria-hidden="true">
          {state === "listening" ? <Mic size={26} /> : state === "speaking" ? <Volume2 size={26} /> : <Bot size={26} />}
        </span>
      </motion.div>

      <p className="vw-orb-label">
        {state === "listening" ? "Listening…" : state === "speaking" ? "Speaking…" : "Tap to speak"}
      </p>
    </div>
  );
}
