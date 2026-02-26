/**
 * langgraph-types.ts — Type definitions for VRIKSHA.ai LangGraph Multi-Agent Pipeline
 * 
 * The graph passes a VrikshaState object between autonomous nodes:
 * 1. Vernacular Q/A Pipeline (Ingestion)
 * 2. Context Fusion & Socratic Planner Agent
 * 3. AST-Aware Code Editor (The Builder)
 * 4. Reflection & Documentation Agent
 * 5. CI/CD & Production Deployment
 */

import type { SupportedLanguage } from './api-config';

// ── Node Identifiers ─────────────────────────────────────────────────────────

export type LangGraphNodeId =
  | 'ingestion'      // Node 1: Vernacular transcription
  | 'planning'       // Node 2: Socratic Planner
  | 'retrieval'      // Vector search for code context
  | 'ast_parsing'    // Tree-sitter AST extraction
  | 'editing'        // Node 3: Qwen Coder diff generation
  | 'reflection'     // Node 4: Verification & documentation
  | 'deployment'     // Node 5: CI/CD trigger
  | 'responding'     // Generating user response
  | 'idle'
  | 'error';

// ── Intent Classification ────────────────────────────────────────────────────

export type UserIntent =
  | 'create_architecture'   // New system design
  | 'edit_intent'          // Modify existing code
  | 'question'             // Clarifying question
  | 'deploy'               // Trigger deployment
  | 'explain'              // Request explanation (Samjhao)
  | 'search'               // Search codebase
  | 'unknown';

// ── Architecture State ───────────────────────────────────────────────────────

export interface ArchitectureComponent {
  id: string;
  type: 'vpc' | 'subnet' | 'lambda' | 'dynamodb' | 's3' | 'api_gateway' | 'cloudfront' | 'rds' | 'ecs' | 'custom';
  name: string;
  config: Record<string, unknown>;
  connections: string[]; // IDs of connected components
  terraformResource?: string;
}

export interface ArchitectureState {
  components: ArchitectureComponent[];
  region: string;
  environment: 'development' | 'staging' | 'production';
  wellArchitectedScore?: number;
  lastUpdated: number;
}

// ── Code State ───────────────────────────────────────────────────────────────

export interface CodeFile {
  path: string;
  content: string;
  language: string;
  lastModified: number;
  symbols?: CodeSymbol[];
}

export interface CodeSymbol {
  name: string;
  type: 'function' | 'class' | 'variable' | 'resource' | 'module' | 'interface';
  startLine: number;
  endLine: number;
  code?: string;
}

export interface CodebaseState {
  files: Record<string, CodeFile>;
  embeddings?: Record<string, number[]>; // Nomic embeddings per file
  lastIndexed: number;
}

// ── Diff & Patch ─────────────────────────────────────────────────────────────

export interface UnifiedDiff {
  filePath: string;
  originalContent: string;
  patchedContent: string;
  diff: string;
  targetSymbol?: string;
  lineRange: { start: number; end: number };
}

export interface PatchResult {
  success: boolean;
  filePath: string;
  error?: string;
  syntaxValid?: boolean;
}

// ── Plan Step ────────────────────────────────────────────────────────────────

export interface PlanStep {
  id: string;
  action: 'create' | 'edit' | 'delete' | 'search' | 'explain';
  file: string;
  symbol?: string;
  description: string;
  rationale?: string; // Why this step is needed
  completed: boolean;
  diff?: UnifiedDiff;
  error?: string;
}

export interface ExecutionPlan {
  goal: string;
  intent: UserIntent;
  steps: PlanStep[];
  clarifyingQuestions?: string[];
  createdAt: number;
}

// ── Conversation State ───────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  language: SupportedLanguage;
  translatedContent?: string; // English translation for processing
  audioUrl?: string; // S3 URL for voice input
  node?: LangGraphNodeId;
}

export interface ConversationState {
  messages: ConversationMessage[];
  currentLanguage: SupportedLanguage;
  sessionId: string;
  userId?: string;
}

// ── Main LangGraph State ─────────────────────────────────────────────────────

export interface VrikshaState {
  // Session
  sessionId: string;
  userId?: string;
  
  // Current processing
  currentNode: LangGraphNodeId;
  isProcessing: boolean;
  error?: string;
  
  // User input
  rawInput: string;           // Original voice/text input
  transcribedText: string;    // After ASR if voice
  translatedText: string;     // English version for LLM
  inputLanguage: SupportedLanguage;
  intent: UserIntent;
  
  // Conversation history
  conversation: ConversationState;
  
  // Architecture state (stored in DynamoDB)
  architecture: ArchitectureState;
  
  // Codebase state
  codebase: CodebaseState;
  
  // Current execution plan
  plan?: ExecutionPlan;
  currentStepIndex: number;
  
  // Generated content
  pendingDiffs: UnifiedDiff[];
  appliedPatches: PatchResult[];
  
  // Documentation
  samjhaoMarkdown?: string;    // Native language explanation
  deploymentDocs?: string;     // English deployment docs
  
  // Metrics
  tokensUsed: number;
  estimatedCost: number;
  
  // Timestamps
  startedAt: number;
  lastUpdatedAt: number;
}

// ── Node Execution Result ────────────────────────────────────────────────────

export interface NodeExecutionResult {
  success: boolean;
  nextNode: LangGraphNodeId;
  stateUpdates: Partial<VrikshaState>;
  userMessage?: string;
  error?: string;
}

// ── Graph Edge Conditions ────────────────────────────────────────────────────

export type EdgeCondition = (state: VrikshaState) => LangGraphNodeId;

export interface GraphEdge {
  from: LangGraphNodeId;
  condition: EdgeCondition;
}

// ── Initial State Factory ────────────────────────────────────────────────────

export function createInitialState(sessionId: string, userId?: string): VrikshaState {
  const now = Date.now();
  return {
    sessionId,
    userId,
    currentNode: 'idle',
    isProcessing: false,
    rawInput: '',
    transcribedText: '',
    translatedText: '',
    inputLanguage: 'en',
    intent: 'unknown',
    conversation: {
      messages: [],
      currentLanguage: 'en',
      sessionId,
      userId,
    },
    architecture: {
      components: [],
      region: 'ap-south-1',
      environment: 'development',
      lastUpdated: now,
    },
    codebase: {
      files: {},
      lastIndexed: 0,
    },
    currentStepIndex: 0,
    pendingDiffs: [],
    appliedPatches: [],
    tokensUsed: 0,
    estimatedCost: 0,
    startedAt: now,
    lastUpdatedAt: now,
  };
}

// ── State Update Helper ──────────────────────────────────────────────────────

export function updateState(
  state: VrikshaState,
  updates: Partial<VrikshaState>
): VrikshaState {
  return {
    ...state,
    ...updates,
    lastUpdatedAt: Date.now(),
  };
}

// ── Token Estimation ─────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  // Rough approximation: ~4 chars per token
  return Math.ceil(text.length / 4);
}

export function estimateCost(tokensUsed: number): number {
  // Approximate cost based on mix of models used
  // Claude: $0.003/1K tokens, Groq: $0.0003/1K, Qwen: $0.001/1K
  const avgCostPer1K = 0.0015;
  return (tokensUsed / 1000) * avgCostPer1K;
}
