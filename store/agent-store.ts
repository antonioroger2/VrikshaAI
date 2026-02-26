/**
 * agent-store.ts — Zustand store for the VRIKSHA.ai LangGraph Multi-Agent Pipeline
 */

import { create } from "zustand";
import { readFile, saveFile, listFiles, detectLanguage } from "@/lib/repo-db";
import { extractSymbols, extractChunk, type CodeSymbol } from "@/lib/ast-parser";
import { createUnifiedDiff, applyPatch, validatePatch, diffStats } from "@/lib/diff-engine";
import { searchFiles } from "@/lib/search-engine";
import { getConfiguredAPIs, isAPIConfigured, type SupportedLanguage } from "@/lib/api-config";
import { translate, translateChatMessage } from "@/lib/translation-service";
import { classifyIntent, generatePlan as llmGeneratePlan } from "@/lib/agents/planner-agent";
import { generateCodeEdit, generateNewFile } from "@/lib/agents/code-editor-agent";
import { reviewCode, generateSamjhao } from "@/lib/agents/reflection-agent";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AgentNodeId =
  | "idle"
  | "planning"
  | "searching"
  | "editing"
  | "reflecting"
  | "applying"
  | "done"
  | "error";

export interface AgentStep {
  id: string;
  node: AgentNodeId;
  timestamp: number;
  message: string;
  detail?: string;
  diff?: string;
  targetFile?: string;
  targetSymbol?: string;
}

export interface AgentPlan {
  goal: string;
  steps: PlanStep[];
}

export interface PlanStep {
  action: "create" | "edit" | "delete" | "search";
  file: string;
  symbol?: string;
  description: string;
}

export interface AgentMessage {
  id: string;
  role: "user" | "agent" | "system";
  text: string;
  timestamp: number;
  node?: AgentNodeId;
  diff?: string;
  file?: string;
}

export interface AgentState {
  running: boolean;
  currentNode: AgentNodeId;
  steps: AgentStep[];
  plan: AgentPlan | null;
  error: string | null;
  messages: AgentMessage[];
  totalEdits: number;
  totalDiffs: number;
  tokensUsed: number;
  inputLanguage: SupportedLanguage;
  wellArchitectedScore: number;
  configuredAPIs: { name: string; configured: boolean }[];
  samjhaoMarkdown: string | null;

  runAgent: (goal: string, language?: SupportedLanguage) => Promise<void>;
  stopAgent: () => void;
  clearHistory: () => void;
  addMessage: (role: "user" | "agent" | "system", text: string) => void;
  setInputLanguage: (lang: SupportedLanguage) => void;
  refreshAPIStatus: () => void;
  applySuggestedDiff: (stepId: string) => Promise<void>;
}

// ── Utility ──────────────────────────────────────────────────────────────────

let abortController: AbortController | null = null;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

// ── The Store ────────────────────────────────────────────────────────────────

export const useAgentStore = create<AgentState>((set, get) => ({
  running: false,
  currentNode: "idle",
  steps: [],
  plan: null,
  error: null,
  messages: [],
  totalEdits: 0,
  totalDiffs: 0,
  tokensUsed: 0,
  inputLanguage: "en" as SupportedLanguage,
  wellArchitectedScore: 0,
  configuredAPIs: [],
  samjhaoMarkdown: null,

  refreshAPIStatus: () => {
    set({ configuredAPIs: getConfiguredAPIs() });
  },

  setInputLanguage: (lang: SupportedLanguage) => {
    set({ inputLanguage: lang });
  },

  addMessage: (role, text) => {
    const msg: AgentMessage = {
      id: uid(),
      role,
      text,
      timestamp: Date.now(),
      node: get().currentNode,
    };
    set((s) => ({ messages: [...s.messages, msg] }));
  },

  clearHistory: () => {
    set({
      steps: [],
      messages: [],
      plan: null,
      error: null,
      currentNode: "idle",
      totalEdits: 0,
      totalDiffs: 0,
      tokensUsed: 0,
      wellArchitectedScore: 0,
      samjhaoMarkdown: null,
    });
  },

  stopAgent: () => {
    abortController?.abort();
    set({ running: false, currentNode: "idle" });
    get().addMessage("system", "Agent stopped by user.");
  },

  applySuggestedDiff: async (stepId: string) => {
    const step = get().steps.find((s) => s.id === stepId);
    if (!step?.diff || !step.targetFile) return;

    const content = await readFile(step.targetFile);
    if (!content) {
      get().addMessage("system", `File not found: ${step.targetFile}`);
      return;
    }

    const patched = applyPatch(content, step.diff);
    if (patched === null) {
      get().addMessage("system", `Patch failed to apply to ${step.targetFile}`);
      return;
    }

    await saveFile(step.targetFile, patched);
    get().addMessage("system", `✅ Patch applied to ${step.targetFile}`);
    set((s) => ({ totalEdits: s.totalEdits + 1 }));
  },

  runAgent: async (goal: string, language?: SupportedLanguage) => {
    abortController = new AbortController();
    const signal = abortController.signal;
    const inputLang = language || get().inputLanguage;

    set({
      running: true,
      currentNode: "planning",
      error: null,
      plan: null,
      inputLanguage: inputLang,
    });

    const addStep = (node: AgentNodeId, message: string, detail?: string, extras?: Partial<AgentStep>) => {
      const step: AgentStep = {
        id: uid(),
        node,
        timestamp: Date.now(),
        message,
        detail,
        ...extras,
      };
      set((s) => ({
        steps: [...s.steps, step],
        currentNode: node,
      }));
      return step;
    };

    const addMsg = get().addMessage;

    try {
      addMsg("user", goal);

      const apis = getConfiguredAPIs();
      set({ configuredAPIs: apis });

      // ─── Node 1: Translation ───────────────────────────────────
      let translatedGoal = goal;
      if (inputLang !== 'en') {
        addStep("planning", `Translating from ${inputLang}...`);
        const translated = await translate({
          text: goal,
          sourceLang: inputLang,
          targetLang: 'en',
        });
        translatedGoal = translated.translatedText;
        addMsg("system", `🌐 Translated: "${translatedGoal}"`);
      }

      // ─── Node 2: Planning ──────────────────────────────────────
      addStep("planning", "Analyzing goal and building plan…");
      addMsg("agent", `🧠 **Planning:** Analyzing "${goal}"…`);
      
      let plan: AgentPlan;
      const hasLLM = isAPIConfigured('groq') || isAPIConfigured('bedrock');

      if (hasLLM) {
        try {
          const files = await listFiles();
          const codebaseState: Record<string, any> = {};
          for (const f of files.slice(0, 10)) {
            const content = await readFile(f);
            if (content != null) {
              codebaseState[f] = { 
                path: f, 
                content: (content as string).slice(0, 2000), 
                language: detectLanguage(f),
                lastModified: Date.now()
              };
            }
          }

          const planResult = await llmGeneratePlan({
            sessionId: 'session-' + uid(),
            currentNode: 'planning',
            isProcessing: true,
            rawInput: goal,
            transcribedText: goal,
            translatedText: translatedGoal,
            inputLanguage: inputLang,
            intent: await classifyIntent(translatedGoal),
            conversation: { messages: [], currentLanguage: inputLang, sessionId: 'session' },
            architecture: { components: [], region: 'ap-south-1', environment: 'development', lastUpdated: Date.now() },
            codebase: { files: codebaseState, lastIndexed: Date.now() },
            currentStepIndex: 0,
            pendingDiffs: [],
            appliedPatches: [],
            tokensUsed: 0,
            estimatedCost: 0,
            startedAt: Date.now(),
            lastUpdatedAt: Date.now(),
          });

          if (planResult?.plan) {
            plan = {
              goal: planResult.plan.goal,
              steps: planResult.plan.steps.map(s => ({
                action: s.action as PlanStep['action'],
                file: s.file,
                symbol: s.symbol,
                description: s.description,
              })),
            };
          } else {
            throw new Error('LLM returned no plan');
          }
        } catch (llmError: any) {
          throw new Error(`Failed to generate plan due to API error: ${llmError.message}`);
        }
      } else {
        throw new Error("No AI providers are configured. Please set up API keys for Groq or Bedrock.");
      }
      
      set({ plan });

      // ─── Step Execution Loop ───────────────────────────────────
      for (const planStep of plan.steps) {
        if (signal.aborted) break;

        switch (planStep.action) {
          case "search":
            addStep("searching", `Searching: ${planStep.description}`);
            await delay(500, signal);
            const results = await searchFiles(planStep.description, 3);
            addMsg("agent", results.length ? `Found ${results.length} matches.` : "No matches found.");
            break;

          case "edit":
            addStep("editing", `Editing ${planStep.file}`, planStep.description);
            const original = await readFile(planStep.file);

            if (!original) {
                throw new Error(`Cannot edit ${planStep.file}: file does not exist`);
            }

            if (!isAPIConfigured('qwen') && !isAPIConfigured('groq')) {
                throw new Error(`Cannot edit ${planStep.file}: no code editing APIs configured`);
            }

            const diff = await generateCodeEdit(planStep.file, original, { ...planStep, id: uid(), completed: false }, detectLanguage(planStep.file));
            const diffText = createUnifiedDiff(planStep.file, original, diff.patchedContent);
            await saveFile(planStep.file, diff.patchedContent);
            addMsg("agent", `✅ Edited ${planStep.file}`);
            set(s => ({ totalEdits: s.totalEdits + 1 }));
            break;

          case "create":
            addStep("editing", `Creating ${planStep.file}`);

            if (!isAPIConfigured('qwen') && !isAPIConfigured('groq')) {
                throw new Error(`Cannot create ${planStep.file}: no code generation APIs configured`);
            }

            const createdContent = await generateNewFile(planStep.file, { ...planStep, id: uid(), completed: false });
            await saveFile(planStep.file, createdContent);
            addMsg("agent", `✅ Created ${planStep.file}`);
            set(s => ({ totalEdits: s.totalEdits + 1 }));
            break;
        }
      }

      // ─── Reflection & Samjhao ──────────────────────────────────
      if (inputLang !== 'en') {
        const samjhao = await generateSamjhao({ /* ... state params ... */ } as any).catch(() => null);
        if (samjhao) set({ samjhaoMarkdown: samjhao });
      }

      addStep("done", "Task completed");
      set({ running: false, currentNode: "done" });

    } catch (err: any) {
      if (signal.aborted) return;
      set({ running: false, currentNode: "error", error: err.message });
      addMsg("system", `❌ Error: ${err.message}`);
    }
  },
}));

// ── Fallback Logic ──────────────────────────────────────────────────────────

