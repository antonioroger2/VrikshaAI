/**
 * planner-agent.ts — Node 2: Context Fusion & Socratic Planner Agent
 * 
 * Powered by Amazon Bedrock (Claude 3.5 Sonnet) or Groq (Llama-3.3-70b)
 * Acts as a senior architect, analyzing requirements and building execution plans
 * Asks clarifying questions instead of generating generic solutions
 */

import { API_CONFIG, isAPIConfigured } from '../api-config';
import { withRetries } from '../utils';
import type {
  VrikshaState,
  ExecutionPlan,
  PlanStep,
  UserIntent,
  NodeExecutionResult,
} from '../langgraph-types';
import { estimateTokens } from '../langgraph-types';

// ── System Prompts ───────────────────────────────────────────────────────────

const SOCRATIC_PLANNER_PROMPT = `You are VRIKSHA.ai, an expert AWS Cloud Architect with a Socratic teaching methodology. You guide users through building production-ready infrastructure by asking clarifying questions before generating code.

**Your Core Principles:**
1. **Socratic Method**: Ask clarifying questions to understand requirements deeply. Never assume solutions.
2. **AWS Well-Architected**: Follow the 6 pillars - Security, Reliability, Performance, Cost Optimization, Operational Excellence, Sustainability.
3. **Minimal Changes**: When modifying existing code, plan surgical edits, not full rewrites.
4. **Vernacular-Friendly**: The user may speak in Hindi, Tamil, or Telugu. Respond in their language with technical terms in English.

**Your Capabilities:**
- Design serverless architectures (Lambda, DynamoDB, API Gateway, S3, CloudFront)
- Generate Terraform and AWS CDK infrastructure code
- Create Next.js frontend applications
- Implement authentication, caching, and CI/CD pipelines

**Output Format (JSON):**
{
  "intent": "create_architecture" | "edit_intent" | "question" | "deploy" | "explain",
  "understanding": "Your understanding of what the user wants",
  "clarifyingQuestions": ["Question 1?", "Question 2?"], // Ask 2-4 questions if needed
  "plan": {
    "goal": "High-level goal description",
    "steps": [
      {
        "action": "create" | "edit" | "delete" | "search",
        "file": "path/to/file.tf",
        "symbol": "aws_dynamodb_table" // Optional: specific symbol to edit
        "description": "What this step accomplishes",
        "rationale": "Why this is needed"
      }
    ]
  },
  "response": "Your response to the user in their language"
}

If you need more information, set clarifyingQuestions and keep plan null until you have enough context.`;

const INTENT_CLASSIFICATION_PROMPT = `Classify the user's intent from their message. Output ONLY one of these intents:
- create_architecture: User wants to build a new system or component
- edit_intent: User wants to modify existing code or infrastructure
- question: User is asking a question or needs clarification
- deploy: User wants to deploy their system
- explain: User wants an explanation of a concept (Samjhao)
- search: User wants to search existing codebase

Respond with just the intent keyword.`;

// ── API Implementations ──────────────────────────────────────────────────────

/**
 * Call Amazon Bedrock Claude 3.5 Sonnet
 */
async function callBedrock(
  systemPrompt: string,
  userMessage: string,
  context?: string
): Promise<string> {
  const { baseUrl, apiKey, model } = API_CONFIG.bedrock;

  if (!apiKey) {
    throw new Error('Bedrock API key not configured');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
        ...(context ? [{ role: 'system', content: `Context:\n${context}` }] : []),
      ],
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Bedrock API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

/**
 * Call Groq Llama-3.3-70b (faster alternative)
 */
async function callGroq(
  systemPrompt: string,
  userMessage: string,
  context?: string
): Promise<string> {
  const { baseUrl, apiKey, model } = API_CONFIG.groq;

  if (!apiKey) {
    throw new Error('Groq API key not configured');
  }

  const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (context) {
    messages.push({ role: 'user', content: `Context:\n${context}` });
    messages.push({ role: 'assistant', content: 'I understand the context. What would you like me to help with?' });
  }

  messages.push({ role: 'user', content: userMessage });

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Groq API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

// ── Main Planner Functions ───────────────────────────────────────────────────

/**
 * Classify user intent from their message
 */
export async function classifyIntent(message: string): Promise<UserIntent> {
  let response: string | null = null;

  if (isAPIConfigured('groq')) {
    try {
      response = await withRetries(() => callGroq(INTENT_CLASSIFICATION_PROMPT, message));
    } catch (e) {
      console.warn('Groq exhausted retries, falling back to Bedrock...', e);
    }
  }

  if (!response && isAPIConfigured('bedrock')) {
    try {
      response = await withRetries(() => callBedrock(INTENT_CLASSIFICATION_PROMPT, message));
    } catch (e) {
      console.warn('Bedrock exhausted retries...', e);
    }
  }

  // NO HARDCODED FALLBACK: Throw an explicit error so the orchestrator halts
  if (!response) {
    throw new Error("All AI providers are currently experiencing high traffic or rate limits. Please try again in a few moments.");
  }

  const intent = response.trim().toLowerCase() as UserIntent;
  const validIntents: UserIntent[] = ['create_architecture', 'edit_intent', 'question', 'deploy', 'explain', 'search'];
  return validIntents.includes(intent) ? intent : 'unknown';
}

/**
 * Generate execution plan using LLM
 */
export async function generatePlan(
  state: VrikshaState
): Promise<{ plan: ExecutionPlan | null; response: string; clarifyingQuestions?: string[] }> {
  const { translatedText, codebase, architecture, conversation } = state;

  // Build context from current state
  const contextParts: string[] = [];

  // Add architecture summary
  if (architecture.components.length > 0) {
    contextParts.push(`Current Architecture:\n${architecture.components.map(c => `- ${c.type}: ${c.name}`).join('\n')}`);
  }

  // Add existing files summary
  const fileList = Object.keys(codebase.files);
  if (fileList.length > 0) {
    contextParts.push(`Existing Files:\n${fileList.join('\n')}`);
  }

  // Add recent conversation for context
  const recentMessages = conversation.messages.slice(-5);
  if (recentMessages.length > 0) {
    contextParts.push(`Recent Conversation:\n${recentMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`);
  }

  const context = contextParts.join('\n\n');

  let response: string | null = null;

  if (isAPIConfigured('groq')) {
    try {
      response = await withRetries(() => callGroq(SOCRATIC_PLANNER_PROMPT, translatedText, context));
    } catch (e) {
      console.warn('Groq failed planning...', e);
    }
  }

  if (!response && isAPIConfigured('bedrock')) {
    try {
      response = await withRetries(() => callBedrock(SOCRATIC_PLANNER_PROMPT, translatedText, context));
    } catch (e) {
      console.warn('Bedrock failed planning...', e);
    }
  }

  // DELETE `generatePlanFallback`. Throw error instead.
  if (!response) {
    throw new Error("Failed to generate an architecture plan due to API rate limits. Please try again.");
  }

  // Parse JSON response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { plan: null, response, clarifyingQuestions: undefined };
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // If we have clarifying questions, return those instead of a plan
  if (parsed.clarifyingQuestions && parsed.clarifyingQuestions.length > 0 && !parsed.plan) {
    return {
      plan: null,
      response: parsed.response || response,
      clarifyingQuestions: parsed.clarifyingQuestions,
    };
  }

  // Build execution plan
  if (parsed.plan) {
    const plan: ExecutionPlan = {
      goal: parsed.plan.goal || translatedText,
      intent: parsed.intent || state.intent,
      steps: (parsed.plan.steps || []).map((s: Partial<PlanStep>, i: number) => ({
        id: `step-${i + 1}`,
        action: s.action || 'create',
        file: s.file || '',
        symbol: s.symbol,
        description: s.description || '',
        rationale: s.rationale,
        completed: false,
      })),
      createdAt: Date.now(),
    };

    return { plan, response: parsed.response || response };
  }

  return { plan: null, response: parsed.response || response };
}

// ── Node Execution ───────────────────────────────────────────────────────────

/**
 * Execute the Planner Node
 */
export async function executePlannerNode(state: VrikshaState): Promise<NodeExecutionResult> {
  try {
    // First classify intent if not already done
    if (state.intent === 'unknown') {
      const intent = await classifyIntent(state.translatedText);
      state = { ...state, intent };
    }

    // Generate plan
    const { plan, response, clarifyingQuestions } = await generatePlan(state);

    // Calculate tokens used
    const tokensUsed = estimateTokens(state.translatedText) + estimateTokens(response);

    // If we have clarifying questions, return to user
    if (clarifyingQuestions && clarifyingQuestions.length > 0) {
      return {
        success: true,
        nextNode: 'responding',
        stateUpdates: {
          plan: plan ?? undefined,
          tokensUsed: state.tokensUsed + tokensUsed,
        },
        userMessage: response + '\n\n' + clarifyingQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n'),
      };
    }

    // If we have a plan, proceed to execution
    if (plan && plan.steps.length > 0) {
      return {
        success: true,
        nextNode: plan.steps[0].action === 'search' ? 'retrieval' : 'editing',
        stateUpdates: {
          plan,
          currentStepIndex: 0,
          tokensUsed: state.tokensUsed + tokensUsed,
        },
        userMessage: response,
      };
    }

    // No plan generated, just respond
    return {
      success: true,
      nextNode: 'responding',
      stateUpdates: {
        tokensUsed: state.tokensUsed + tokensUsed,
      },
      userMessage: response,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      nextNode: 'error',
      stateUpdates: {
        error: errorMessage,
      },
      error: errorMessage,
    };
  }
}
