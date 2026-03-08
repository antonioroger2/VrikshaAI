"use client";

import React, { useEffect, useMemo, useState, useRef } from "react";
import styles from "./FirstRunWalkthrough.module.css";
import { WALKTHROUGH_STEPS } from "./walkthrough-data";

const STORAGE_KEY = "vriksha:first-run-walkthrough:v1";

export default function FirstRunWalkthrough() {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [spotlightRect, setSpotlightRect] = useState<DOMRect | null>(null);
  const spotlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkStorage = () => {
      const seen = window.localStorage.getItem(STORAGE_KEY);
      setIsOpen(seen !== "seen");
    };

    checkStorage();
    setIsReady(true);

    // Listen for replay event
    const handleReplay = () => {
      window.localStorage.removeItem(STORAGE_KEY);
      setIsOpen(true);
      setActiveIndex(0);
    };

    window.addEventListener('replay-tour', handleReplay);

    return () => {
      window.removeEventListener('replay-tour', handleReplay);
    };
  }, []);

  // Update spotlight position when step changes
  useEffect(() => {
    if (!isOpen) {
      setSpotlightRect(null);
      return;
    }

    const step = WALKTHROUGH_STEPS[activeIndex];
    if (step.spotlight) {
      const element = document.querySelector(step.spotlight.selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        setSpotlightRect(rect);
      } else {
        setSpotlightRect(null);
      }
    } else {
      setSpotlightRect(null);
    }
  }, [activeIndex, isOpen]);

  const currentStep = WALKTHROUGH_STEPS[activeIndex];
  const progressLabel = useMemo(
    () => `${activeIndex + 1} / ${WALKTHROUGH_STEPS.length}`,
    [activeIndex]
  );

  const closeWalkthrough = () => {
    window.localStorage.setItem(STORAGE_KEY, "seen");
    setIsOpen(false);
  };

  const goNext = () => {
    if (activeIndex === WALKTHROUGH_STEPS.length - 1) {
      closeWalkthrough();
      return;
    }
    setActiveIndex((index) => index + 1);
  };

  const goBack = () => {
    setActiveIndex((index) => Math.max(0, index - 1));
  };

  if (!isReady || !isOpen) {
    return null;
  }

  return (
    <div>
      <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="VRIKSHA walkthrough">
      <div className={styles.backdrop} onClick={closeWalkthrough} />

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

            <button type="button" className={styles.closeButton} onClick={closeWalkthrough}>
              Skip tour
            </button>
          </div>

          <p className={styles.summary}>{currentStep.summary}</p>

          <div className={styles.grid}>
            <div className={styles.card}>
              <div className={styles.cardTitle}>Why this matters</div>
              <div className={styles.pillRow}>
                {currentStep.highlights.map((highlight) => (
                  <span key={highlight} className={styles.highlightPill}>
                    {highlight}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.card}>
              <div className={styles.cardTitle}>Modules to inspect</div>
              <div className={styles.moduleList}>
                {currentStep.modules.map((module) => (
                  <div key={`${currentStep.id}-${module.file}`} className={styles.moduleItem}>
                    <div className={styles.moduleLabel}>{module.label}</div>
                    <div className={styles.moduleFile}>{module.file}</div>
                    <div className={styles.moduleNote}>{module.note}</div>
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
                  <div key={item} className={styles.flowItem}>
                    {item}
                  </div>
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
                {activeIndex === WALKTHROUGH_STEPS.length - 1 ? "Enter workspace" : "Next module"}
              </button>
            </div>
          </div>
        </section>
      </div>
      </div>
    </div>
  );
}