/**
 * langgraph-orchestrator.ts — Main LangGraph Multi-Agent Pipeline Orchestrator
 * 
 * The system operates as a state machine that passes a VrikshaState object
 * between autonomous nodes:
 * 
 * 1. Ingestion → Transcribe/translate voice input
 * 2. Planning → Socratic questioning & plan generation
 * 3. Retrieval → Vector search for code context
 * 4. Editing → AST-aware code generation
 * 5. Reflection → Verification & documentation
 * 6. Responding → Generate response to user
 */

import type {
  VrikshaState,
  LangGraphNodeId,
  NodeExecutionResult,
  ConversationMessage,
} from './langgraph-types';
import { createInitialState, updateState, estimateTokens, estimateCost } from './langgraph-types';
import { type SupportedLanguage } from './api-config';
import { translate, detectLanguage, translateChatMessage } from './translation-service';
import { executePlannerNode, classifyIntent } from './agents/planner-agent';
import { executeCodeEditorNode, searchCodebase } from './agents/code-editor-agent';
import { executeReflectionNode } from './agents/reflection-agent';

// ── Abort Controller ─────────────────────────────────────────────────────────

let abortController: AbortController | null = null;

// ── Node Executor Type ───────────────────────────────────────────────────────

type NodeExecutor = (state: VrikshaState) => Promise<NodeExecutionResult>;

// ── Node Executors Map ───────────────────────────────────────────────────────

const nodeExecutors: Record<LangGraphNodeId, NodeExecutor> = {
  idle: async (state) => ({
    success: true,
    nextNode: 'idle',
    stateUpdates: {},
  }),

  ingestion: executeIngestionNode,
  planning: executePlannerNode,
  retrieval: executeRetrievalNode,
  ast_parsing: executeAstParsingNode,
  editing: executeCodeEditorNode,
  reflection: executeReflectionNode,
  deployment: executeDeploymentNode,
  responding: executeRespondingNode,

  error: async (state) => ({
    success: false,
    nextNode: 'idle',
    stateUpdates: {},
    error: state.error,
  }),
};

// ── Ingestion Node (Node 1) ──────────────────────────────────────────────────

/**
 * Node 1: Vernacular Q/A Pipeline (Ingestion)
 * Handles voice transcription and translation to English
 */
async function executeIngestionNode(state: VrikshaState): Promise<NodeExecutionResult> {
  try {
    const { rawInput, inputLanguage } = state;

    // If input is already transcribed (text input), just translate
    let transcribedText = state.transcribedText || rawInput;
    let translatedText = transcribedText;

    // Detect language if not specified
    let detectedLanguage = inputLanguage;
    if (inputLanguage === 'en' && transcribedText) {
      detectedLanguage = await detectLanguage(transcribedText);
    }

    // Translate to English if needed
    if (detectedLanguage !== 'en') {
      const translated = await translate({
        text: transcribedText,
        sourceLang: detectedLanguage,
        targetLang: 'en',
      });
      translatedText = translated.translatedText;
    }

    // Classify intent
    const intent = await classifyIntent(translatedText);

    return {
      success: true,
      nextNode: 'planning',
      stateUpdates: {
        transcribedText,
        translatedText,
        inputLanguage: detectedLanguage,
        intent,
        tokensUsed: state.tokensUsed + estimateTokens(transcribedText),
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      nextNode: 'error',
      stateUpdates: { error: errorMessage },
      error: errorMessage,
    };
  }
}

// ── Retrieval Node ───────────────────────────────────────────────────────────

/**
 * Vector search for relevant code context using Nomic Embed Code
 */
async function executeRetrievalNode(state: VrikshaState): Promise<NodeExecutionResult> {
  try {
    const { plan, currentStepIndex, codebase, translatedText } = state;

    if (!plan) {
      return {
        success: true,
        nextNode: 'planning',
        stateUpdates: {},
      };
    }

    const currentStep = plan.steps[currentStepIndex];
    const searchQuery = currentStep?.description || translatedText;

    // Perform vector search
    const relevantFiles = await searchCodebase(searchQuery, codebase, 5);

    // Update step with search results
    const updatedPlan = {
      ...plan,
      steps: plan.steps.map((s, i) =>
        i === currentStepIndex
          ? { ...s, completed: true }
          : s
      ),
    };

    // Determine next node
    const nextStepIndex = currentStepIndex + 1;
    const hasMoreSteps = nextStepIndex < plan.steps.length;
    const nextStep = hasMoreSteps ? plan.steps[nextStepIndex] : null;

    let nextNode: LangGraphNodeId = 'reflection';
    if (hasMoreSteps && nextStep) {
      nextNode = nextStep.action === 'search' ? 'retrieval' : 'editing';
    }

    return {
      success: true,
      nextNode,
      stateUpdates: {
        plan: updatedPlan,
        currentStepIndex: nextStepIndex,
      },
      userMessage: relevantFiles.length > 0
        ? `Found ${relevantFiles.length} relevant files: ${relevantFiles.slice(0, 3).join(', ')}`
        : 'No matching files found in codebase.',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      nextNode: 'error',
      stateUpdates: { error: errorMessage },
      error: errorMessage,
    };
  }
}

// ── AST Parsing Node ─────────────────────────────────────────────────────────

/**
 * Tree-sitter AST extraction for targeted code editing
 */
async function executeAstParsingNode(state: VrikshaState): Promise<NodeExecutionResult> {
  // AST parsing is now integrated into the code-editor-agent
  // This node is kept for explicit AST operations if needed
  return {
    success: true,
    nextNode: 'editing',
    stateUpdates: {},
  };
}

// ── Deployment Node (Node 5) ─────────────────────────────────────────────────

/**
 * Node 5: CI/CD & Production Deployment
 * Triggers deployment pipeline (future implementation)
 */
async function executeDeploymentNode(state: VrikshaState): Promise<NodeExecutionResult> {
  // TODO: Implement actual deployment trigger
  // This would call AWS Lambda to execute Terraform
  return {
    success: true,
    nextNode: 'responding',
    stateUpdates: {},
    userMessage: '🚀 Deployment ready! Run `terraform apply` to deploy your infrastructure.',
  };
}

// ── Responding Node ──────────────────────────────────────────────────────────

/**
 * Generate final response to user in their language
 */
async function executeRespondingNode(state: VrikshaState): Promise<NodeExecutionResult> {
  // Response is compiled from previous nodes' userMessages
  // This node handles any final translation if needed
  return {
    success: true,
    nextNode: 'idle',
    stateUpdates: {
      isProcessing: false,
    },
  };
}

// ── Main Orchestrator ────────────────────────────────────────────────────────

export interface VrikshaOrchestrator {
  state: VrikshaState;
  run: (input: string, language?: SupportedLanguage) => Promise<VrikshaState>;
  stop: () => void;
  reset: () => void;
  onNodeChange?: (node: LangGraphNodeId, message?: string) => void;
  onMessage?: (message: ConversationMessage) => void;
}

/**
 * Create a new VRIKSHA.ai orchestrator instance
 */
export function createOrchestrator(
  sessionId: string,
  userId?: string
): VrikshaOrchestrator {
  let state = createInitialState(sessionId, userId);
  let onNodeChangeCallback: ((node: LangGraphNodeId, message?: string) => void) | undefined;
  let onMessageCallback: ((message: ConversationMessage) => void) | undefined;

  /**
   * Add a message to conversation history
   */
  function addMessage(
    role: 'user' | 'assistant' | 'system',
    content: string,
    node?: LangGraphNodeId
  ): void {
    const message: ConversationMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
      language: state.inputLanguage,
      node,
    };

    state = updateState(state, {
      conversation: {
        ...state.conversation,
        messages: [...state.conversation.messages, message],
      },
    });

    onMessageCallback?.(message);
  }

  /**
   * Run the agent pipeline
   */
  async function run(
    input: string,
    language: SupportedLanguage = 'en'
  ): Promise<VrikshaState> {
    abortController = new AbortController();
    const signal = abortController.signal;

    // Initialize state for this run
    state = updateState(state, {
      rawInput: input,
      transcribedText: input,
      inputLanguage: language,
      currentNode: 'ingestion',
      isProcessing: true,
      error: undefined,
      pendingDiffs: [],
      appliedPatches: [],
      currentStepIndex: 0,
      plan: undefined,
    });

    // Add user message
    addMessage('user', input);
    onNodeChangeCallback?.('ingestion', 'Processing input...');

    try {
      // Run the graph until we reach idle or error
      let maxIterations = 20; // Safety limit
      let iteration = 0;

      while (
        state.currentNode !== 'idle' &&
        state.currentNode !== 'error' &&
        iteration < maxIterations &&
        !signal.aborted
      ) {
        iteration++;

        const executor = nodeExecutors[state.currentNode];
        if (!executor) {
          throw new Error(`Unknown node: ${state.currentNode}`);
        }

        // Execute current node
        const result = await executor(state);

        // Update state
        state = updateState(state, {
          ...result.stateUpdates,
          currentNode: result.nextNode,
          estimatedCost: estimateCost(state.tokensUsed + (result.stateUpdates.tokensUsed || 0)),
        });

        // Notify of node change
        onNodeChangeCallback?.(result.nextNode, result.userMessage);

        // Add agent message if there's one
        if (result.userMessage) {
          // Translate to user's language if needed
          let translatedMessage = result.userMessage;
          if (state.inputLanguage !== 'en') {
            translatedMessage = await translateChatMessage(
              result.userMessage,
              'en',
              state.inputLanguage
            );
          }
          addMessage('assistant', translatedMessage, result.nextNode);
        }

        // Handle errors
        if (!result.success && result.error) {
          addMessage('system', `Error: ${result.error}`, 'error');
        }

        // Small delay between nodes for UI feedback
        await delay(100);
      }

      if (iteration >= maxIterations) {
        state = updateState(state, {
          currentNode: 'error',
          error: 'Maximum iterations reached',
          isProcessing: false,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      state = updateState(state, {
        currentNode: 'error',
        error: errorMessage,
        isProcessing: false,
      });
      addMessage('system', `Error: ${errorMessage}`, 'error');
    }

    return state;
  }

  /**
   * Stop the current run
   */
  function stop(): void {
    abortController?.abort();
    state = updateState(state, {
      isProcessing: false,
      currentNode: 'idle',
    });
    onNodeChangeCallback?.('idle', 'Stopped by user');
  }

  /**
   * Reset to initial state
   */
  function reset(): void {
    state = createInitialState(sessionId, userId);
    onNodeChangeCallback?.('idle', 'Reset');
  }

  return {
    get state() {
      return state;
    },
    run,
    stop,
    reset,
    set onNodeChange(callback: ((node: LangGraphNodeId, message?: string) => void) | undefined) {
      onNodeChangeCallback = callback;
    },
    set onMessage(callback: ((message: ConversationMessage) => void) | undefined) {
      onMessageCallback = callback;
    },
  };
}

// ── Utility ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Export for external use ──────────────────────────────────────────────────

export {
  type VrikshaState,
  type LangGraphNodeId,
  type NodeExecutionResult,
  type ConversationMessage,
  createInitialState,
  updateState,
};
