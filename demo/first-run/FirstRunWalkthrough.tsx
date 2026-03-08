"use client";

import React, { useEffect, useMemo, useState, useCallback } from "react";
import styles from "./FirstRunWalkthrough.module.css";
import { WALKTHROUGH_STEPS } from "./walkthrough-data";

const STORAGE_KEY = "vriksha:first-run-walkthrough:v1";

export default function FirstRunWalkthrough() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [mode, setMode] = useState<"spotlight" | "detail">("spotlight");
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const seen = window.localStorage.getItem(STORAGE_KEY);
    setIsOpen(seen !== "seen");
    setIsReady(true);

    const handleReplay = () => {
      window.localStorage.removeItem(STORAGE_KEY);
      setIsOpen(true);
      setActiveIndex(0);
      setMode("spotlight");
    };

    window.addEventListener("replay-tour", handleReplay);
    return () => window.removeEventListener("replay-tour", handleReplay);
  }, []);

  /* ── Measure the target element and keep it updated ── */
  const measureTarget = useCallback(() => {
    const step = WALKTHROUGH_STEPS[activeIndex];
    if (!step.spotlight) { setSpotlightRect(null); return; }
    const el = document.querySelector(step.spotlight.selector);
    if (el) {
      setSpotlightRect(el.getBoundingClientRect());
    } else {
      setSpotlightRect(null);
    }
  }, [activeIndex]);

  useEffect(() => {
    if (!isOpen) { setSpotlightRect(null); return; }
    // Small delay so DOM paints first
    const raf = requestAnimationFrame(() => measureTarget());
    window.addEventListener("resize", measureTarget);
    window.addEventListener("scroll", measureTarget, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measureTarget);
      window.removeEventListener("scroll", measureTarget, true);
    };
  }, [isOpen, measureTarget]);

  const currentStep = WALKTHROUGH_STEPS[activeIndex];
  const isLast = activeIndex === WALKTHROUGH_STEPS.length - 1;
  const progressLabel = useMemo(
    () => `${activeIndex + 1} / ${WALKTHROUGH_STEPS.length}`,
    [activeIndex]
  );

  const closeWalkthrough = () => {
    window.localStorage.setItem(STORAGE_KEY, "seen");
    setIsOpen(false);
  };

  const goNext = () => {
    if (isLast) { closeWalkthrough(); return; }
    setActiveIndex((i) => i + 1);
    setMode("spotlight");
  };

  const goBack = () => {
    setActiveIndex((i) => Math.max(0, i - 1));
    setMode("spotlight");
  };

  /* ── Compute where to place the tooltip card — always clamped inside viewport ── */
  const tooltipStyle = useMemo((): React.CSSProperties => {
    const TW = 360; // tooltip width (matches CSS min)
    const TH = 340; // tooltip estimated height
    const GAP = 16;
    const MARGIN = 12; // min edge margin

    if (!spotlightRect || !currentStep.spotlight) {
      return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    }

    const r = spotlightRect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Available space on each side of the highlighted element
    const spaceRight = vw - r.right - GAP;
    const spaceLeft = r.left - GAP;
    const spaceBottom = vh - r.bottom - GAP;
    const spaceTop = r.top - GAP;

    // Pick the side with the most room
    let top: number;
    let left: number;

    if (spaceRight >= TW) {
      // Place to the right
      left = r.right + GAP;
      top = r.top + r.height / 2 - TH / 2;
    } else if (spaceLeft >= TW) {
      // Place to the left
      left = r.left - GAP - TW;
      top = r.top + r.height / 2 - TH / 2;
    } else if (spaceBottom >= TH) {
      // Place below
      top = r.bottom + GAP;
      left = r.left + r.width / 2 - TW / 2;
    } else if (spaceTop >= TH) {
      // Place above
      top = r.top - GAP - TH;
      left = r.left + r.width / 2 - TW / 2;
    } else {
      // No room on any side — overlap: bottom-right of viewport
      top = vh - TH - MARGIN;
      left = vw - TW - MARGIN;
    }

    // Clamp to viewport
    top = Math.max(MARGIN, Math.min(top, vh - TH - MARGIN));
    left = Math.max(MARGIN, Math.min(left, vw - TW - MARGIN));

    return { top, left };
  }, [spotlightRect, currentStep.spotlight]);

  if (!isReady || !isOpen) return null;

  /* ── Build the SVG overlay mask: dark everywhere, transparent cutout over target ── */
  const renderOverlay = () => {
    if (!spotlightRect) {
      // No target found — just a semi-transparent scrim
      return (
        <div className={styles.scrim} onClick={(e) => e.stopPropagation()} />
      );
    }

    const r = spotlightRect;
    const pad = 10;
    const x = r.left - pad;
    const y = r.top - pad;
    const w = r.width + pad * 2;
    const h = r.height + pad * 2;
    const rx = 12;

    return (
      <svg className={styles.svgOverlay} viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`} preserveAspectRatio="none">
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect x={x} y={y} width={w} height={h} rx={rx} ry={rx} fill="black" />
          </mask>
        </defs>
        {/* Dark overlay with cutout */}
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.72)" mask="url(#spotlight-mask)" />
        {/* Glowing border around the cutout */}
        <rect
          x={x} y={y} width={w} height={h} rx={rx} ry={rx}
          fill="none"
          stroke="rgba(168,224,99,0.5)"
          strokeWidth="3"
          className={styles.glowRect}
        />
      </svg>
    );
  };

  /* ──────────── SPOTLIGHT MODE ──────────── */
  if (mode === "spotlight") {
    return (
      <>
        {renderOverlay()}

        {/* Tooltip card next to the highlight */}
        <div className={styles.spotlightTooltip} style={tooltipStyle}>
          <div className={styles.tooltipHeader}>
            <span className={styles.tooltipStep}>
              {activeIndex + 1} / {WALKTHROUGH_STEPS.length}
            </span>
            <button className={styles.tooltipSkipBtn} onClick={closeWalkthrough} type="button">
              Skip tour
            </button>
          </div>

          <div className={styles.tooltipEyebrow}>{currentStep.eyebrow}</div>
          <h3 className={styles.tooltipTitle}>{currentStep.title}</h3>
          <p className={styles.tooltipText}>
            {currentStep.spotlight?.text || currentStep.summary}
          </p>

          <div className={styles.tooltipActions}>
            <button className={styles.learnMoreBtn} onClick={() => setMode("detail")} type="button">
              Learn more
            </button>
          </div>

          <div className={styles.tooltipNav}>
            <button
              className={styles.tooltipNavBtn}
              onClick={goBack}
              disabled={activeIndex === 0}
              type="button"
            >
              Back
            </button>
            <button className={styles.tooltipNavBtnPrimary} onClick={goNext} type="button">
              {isLast ? "Finish" : "Next"}
            </button>
          </div>

          {/* Step dots */}
          <div className={styles.tooltipDots}>
            {WALKTHROUGH_STEPS.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`${styles.tooltipDot} ${i === activeIndex ? styles.tooltipDotActive : ""}`}
                onClick={() => setActiveIndex(i)}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </>
    );
  }

  /* ──────────── DETAIL MODE (Learn more) ──────────── */
  return (
    <>
      {renderOverlay()}

      <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="VRIKSHA walkthrough">
        <div className={styles.shell}>
          <aside className={styles.rail}>
            <div>
              <div className={styles.kicker}>First-Run Walkthrough</div>
              <h2 className={styles.railTitle}>What makes this repo advanced</h2>
              <p className={styles.railCopy}>
                This tour points to the real modules behind the agent builder, AWS focus, AST edits,
                vector retrieval, and multilingual workflow.
              </p>
            </div>

            <div className={styles.stepList}>
              {WALKTHROUGH_STEPS.map((step, index) => (
                <button
                  key={step.id}
                  type="button"
                  className={`${styles.stepButton} ${index === activeIndex ? styles.stepButtonActive : ""}`}
                  onClick={() => setActiveIndex(index)}
                >
                  <span className={styles.stepIndex}>{String(index + 1).padStart(2, "0")}</span>
                  <span className={styles.stepText}>{step.eyebrow}</span>
                </button>
              ))}
            </div>

            <div className={styles.progressCard}>
              <span className={styles.progressPill}>{progressLabel}</span>
              <span className={styles.progressText}>Focused on actual implementation files, not marketing copy.</span>
            </div>
          </aside>

          <section className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <div className={styles.eyebrow}>{currentStep.eyebrow}</div>
                <h1 className={styles.title}>{currentStep.title}</h1>
              </div>

              <div className={styles.panelHeaderActions}>
                <button type="button" className={styles.backToSpotlightBtn} onClick={() => setMode("spotlight")}>
                  ← Back to spotlight
                </button>
                <button type="button" className={styles.closeButton} onClick={closeWalkthrough}>
                  Skip tour
                </button>
              </div>
            </div>

            <p className={styles.summary}>{currentStep.summary}</p>

            <div className={styles.grid}>
              <div className={styles.card}>
                <div className={styles.cardTitle}>Why this matters</div>
                <div className={styles.pillRow}>
                  {currentStep.highlights.map((h) => (
                    <span key={h} className={styles.highlightPill}>{h}</span>
                  ))}
                </div>
              </div>

              <div className={styles.card}>
                <div className={styles.cardTitle}>Modules to inspect</div>
                <div className={styles.moduleList}>
                  {currentStep.modules.map((m) => (
                    <div key={`${currentStep.id}-${m.file}`} className={styles.moduleItem}>
                      <div className={styles.moduleLabel}>{m.label}</div>
                      <div className={styles.moduleFile}>{m.file}</div>
                      <div className={styles.moduleNote}>{m.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {currentStep.builderFlow && (
              <div className={styles.flowCard}>
                <div className={styles.cardTitle}>Builder flow</div>
                <div className={styles.flowList}>
                  {currentStep.builderFlow.map((item) => (
                    <div key={item} className={styles.flowItem}>{item}</div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.footer}>
              <div className={styles.footerNote}>
                Tour code lives under <span className={styles.inlinePath}>/demo</span> so the main app logic stays clean.
              </div>

              <div className={styles.actions}>
                <button type="button" className={styles.secondaryButton} onClick={goBack} disabled={activeIndex === 0}>
                  Back
                </button>
                <button type="button" className={styles.primaryButton} onClick={goNext}>
                  {isLast ? "Enter workspace" : "Next module"}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}