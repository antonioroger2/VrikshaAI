/**
 * planner-agent.ts — Node 2: Context Fusion & Socratic Planner Agent
 * 
 * Powered by Amazon Bedrock (Claude 3.5 Sonnet) or Groq (Llama-3.3-70b)
 * Acts as a senior architect, analyzing requirements and building execution plans
 * Asks clarifying questions instead of generating generic solutions
 */

import { API_CONFIG, isAPIConfigured } from '../api-config';
import { withSmartRetries } from '../utils';
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

**CRITICAL INSTRUCTION: OUTPUT FORMAT**
DO NOT respond conversationally. DO NOT continue previous conversations. ALWAYS output ONLY valid JSON with this exact structure:

{
  "intent": "create_architecture" | "edit_intent" | "question" | "deploy" | "explain",
  "understanding": "Brief summary of user requirements",
  "clarifyingQuestions": null,
  "plan": {
    "goal": "High-level goal description",
    "steps": [
      {
        "action": "create" | "edit" | "delete" | "search",
        "file": "path/to/file.ext",
        "symbol": "optional_symbol_name",
        "description": "What this step accomplishes",
        "rationale": "Why this is needed"
      }
    ]
  },
  "response": "Response message for user"
}

**Your Core Principles:**
1. **Socratic Method**: Ask clarifying questions ONLY when requirements are truly ambiguous or missing critical information. If the user provides clear, specific requirements, proceed directly to planning.
2. **Be Decisive**: When you have enough information to build a working solution (even if basic), create a plan. Don't ask questions just to be thorough.
3. **AWS Well-Architected**: Follow the 6 pillars - Security, Reliability, Performance, Cost Optimization, Operational Excellence, Sustainability.
4. **Minimal Changes**: When modifying existing code, plan surgical edits, not full rewrites.
5. **Vernacular-Friendly**: The user may speak in Hindi, Tamil, or Telugu. Respond in their language with technical terms in English.

**When to Ask Questions vs. When to Plan:**
- **Ask Questions**: Only if the request is completely unclear (e.g., "build something" with no specifics)
- **Proceed to Plan**: If you have basic requirements like technology stack, deployment type, or core features
- **Build Minimum Viable**: Start with a working basic version, then iterate based on user feedback

**Your Capabilities:**
- Design serverless architectures (Lambda, DynamoDB, API Gateway, S3, CloudFront)
- Generate Terraform and AWS CDK infrastructure code
- Create Next.js frontend applications
- Implement authentication, caching, and CI/CD pipelines

**CRITICAL: Output Format**
You MUST output ONLY valid JSON. Do not include any markdown formatting, explanations, or additional text outside the JSON object. The response should start with { and end with }.

{
  "intent": "create_architecture" | "edit_intent" | "question" | "deploy" | "explain",
  "understanding": "Your understanding of what the user wants",
  "clarifyingQuestions": ["Question 1?", "Question 2?"], // ONLY include if requirements are truly unclear. Set to null if you have enough info to proceed.
  "plan": {
    "goal": "High-level goal description",
    "steps": [
      {
        "action": "create" | "edit" | "delete" | "search",
        "file": "path/to/file.tf",
        "symbol": "aws_dynamodb_table", // Optional: specific symbol to edit
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

  // Include context in the system prompt if provided
  const fullSystemPrompt = context 
    ? `${systemPrompt}\n\nCONTEXT INFORMATION:\n${context}\n\nUse this context to understand the current state, but always respond with JSON only.`
    : systemPrompt;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: fullSystemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1, // Very low temperature for strict JSON output
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

  // Include context in the system prompt if provided
  const fullSystemPrompt = context 
    ? `${systemPrompt}\n\nCONTEXT INFORMATION:\n${context}\n\nUse this context to understand the current state, but always respond with JSON only.`
    : systemPrompt;

  const messages: { role: 'system' | 'user'; content: string }[] = [
    { role: 'system', content: fullSystemPrompt },
    { role: 'user', content: userMessage },
  ];

  const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.1, // Very low temperature for strict JSON output
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const errorDetails = {
      status: response.status,
      statusText: response.statusText,
      url: `${baseUrl}/openai/v1/chat/completions`,
      headers: Object.fromEntries(response.headers.entries()),
      body: errorText,
    };
    console.error('🔍 Detailed Groq API Error:', JSON.stringify(errorDetails, null, 2));
    throw new Error(`Groq API error (${response.status} ${response.statusText}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

// ── Main Planner Functions ───────────────────────────────────────────────────

/**
 * Fallback parser for markdown-formatted LLM responses
 */
function parseMarkdownResponse(response: string): any | null {
  try {
    const lines = response.split('\n').map(line => line.trim());
    const parsed: any = {};

    let currentSection = '';
    let clarifyingQuestions: string[] = [];

    for (const line of lines) {
      if (line.startsWith('**Intent:**')) {
        parsed.intent = line.replace('**Intent:**', '').trim();
      } else if (line.startsWith('**Understanding:**')) {
        parsed.understanding = line.replace('**Understanding:**', '').trim();
      } else if (line.startsWith('**Clarifying Questions:**')) {
        currentSection = 'clarifyingQuestions';
      } else if (line.startsWith('**Plan:**')) {
        const planValue = line.replace('**Plan:**', '').trim();
        if (planValue === 'null') {
          parsed.plan = null;
        }
        currentSection = 'plan';
      } else if (line.startsWith('**Response:**')) {
        parsed.response = line.replace('**Response:**', '').trim();
        currentSection = 'response';
      } else if (currentSection === 'clarifyingQuestions' && line.match(/^\d+\./)) {
        // Extract numbered questions
        const question = line.replace(/^\d+\.\s*/, '').trim();
        if (question) clarifyingQuestions.push(question);
      } else if (currentSection === 'response' && parsed.response) {
        // Continue response text
        parsed.response += '\n' + line;
      }
    }

    if (clarifyingQuestions.length > 0) {
      parsed.clarifyingQuestions = clarifyingQuestions;
    }

    // Only return if we have some valid data
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  } catch (e) {
    console.warn('⚠️ Markdown parsing failed:', e);
  }

  return null;
}

/**
 * Classify user intent from their message
 */
export async function classifyIntent(
  message: string,
  onStatus?: (msg: string) => void
): Promise<UserIntent> {
  let response: string | null = null;
  const estimatedTokens = 500;
  const apiErrors: string[] = [];

  if (isAPIConfigured('groq')) {
    try {
      response = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroq(INTENT_CLASSIFICATION_PROMPT, message),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Groq API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  if (!response && isAPIConfigured('bedrock')) {
    try {
      response = await withSmartRetries(
        'bedrock', estimatedTokens,
        () => callBedrock(INTENT_CLASSIFICATION_PROMPT, message),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Bedrock API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  if (!response) {
    console.error('🚨 CRITICAL: All AI providers failed for intent classification!');
    console.error('📋 Failed APIs:', apiErrors);
    console.error('💡 Troubleshooting: Check API keys, network connectivity, and rate limits');
    throw new Error('All AI providers are currently experiencing high traffic or rate limits. Please try again in a few moments.');
  }

  const intent = response.trim().toLowerCase() as UserIntent;
  const validIntents: UserIntent[] = ['create_architecture', 'edit_intent', 'question', 'deploy', 'explain', 'search'];
  console.log('🎯 Classified intent:', intent, 'from response:', response);
  return validIntents.includes(intent) ? intent : 'unknown';
}

/**
 * Generate execution plan using LLM
 */
export async function generatePlan(
  state: VrikshaState,
  onStatus?: (msg: string) => void
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

  const estimatedTokens = estimateTokens(translatedText + context) + 2000;
  const apiErrors: string[] = [];

  if (isAPIConfigured('groq')) {
    try {
      response = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroq(SOCRATIC_PLANNER_PROMPT, translatedText, context),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Groq API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  if (!response && isAPIConfigured('bedrock')) {
    try {
      response = await withSmartRetries(
        'bedrock', estimatedTokens,
        () => callBedrock(SOCRATIC_PLANNER_PROMPT, translatedText, context),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Bedrock API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  // DELETE `generatePlanFallback`. Throw error instead.
  if (!response) {
    console.error('🚨 CRITICAL: All AI providers failed for plan generation!');
    console.error('📋 Failed APIs:', apiErrors);
    console.error('💡 Troubleshooting: Check API keys, network connectivity, and rate limits');
    throw new Error("Failed to generate an architecture plan due to API rate limits. Please try again.");
  }

  // Parse JSON response
  let parsed: any = null;
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.warn('⚠️ JSON parsing failed, attempting fallback parsing');
    }
  }

  // Fallback: Parse markdown-formatted response
  if (!parsed) {
    parsed = parseMarkdownResponse(response);
  }

  // Last resort: If still no valid parsing, create a default plan for basic requests
  if (!parsed) {
    console.warn('⚠️ No valid response format found, creating default plan for basic request');
    parsed = {
      intent: 'create_architecture',
      understanding: 'User wants to build something, creating basic plan',
      clarifyingQuestions: null,
      plan: {
        goal: translatedText,
        steps: [
          {
            action: 'create',
            file: 'index.html',
            description: 'Create a basic HTML file',
            rationale: 'Starting with a basic web page'
          }
        ]
      },
      response: 'Creating a basic plan to get started. Let me know if you need any specific changes.'
    };
  }

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

    console.log('✅ Plan generated successfully:', { goal: plan.goal, stepsCount: plan.steps.length });
    return { plan, response: parsed.response || response };
  }

  console.warn('⚠️ Response parsed but no plan found');
  console.log('🔍 Parsed Response:', JSON.stringify(parsed, null, 2));
  return { plan: null, response: parsed.response || response };
}

// ── Node Execution ───────────────────────────────────────────────────────────

/**
 * Execute the Planner Node
 */
export async function executePlannerNode(
  state: VrikshaState,
  onStatus?: (msg: string) => void
): Promise<NodeExecutionResult> {
  try {
    // First classify intent if not already done
    if (state.intent === 'unknown') {
      const intent = await classifyIntent(state.translatedText, onStatus);
      state = { ...state, intent };
    }

    // Generate plan
    const { plan, response, clarifyingQuestions } = await generatePlan(state, onStatus);

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
