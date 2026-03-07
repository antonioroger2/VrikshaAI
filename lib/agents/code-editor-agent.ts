/**
 * code-editor-agent.ts — Node 3: AST-Aware Code Editor (The Builder)
 * 
 * Process:
 * 1. Retrieval: Nomic Embed Code performs vector search over generated files
 * 2. Localization: Tree-sitter AST parser isolates exact function/resource block
 * 3. Patch Generation: Qwen3 Coder (free via OpenRouter with fallback) outputs strict Unified Diff format
 * 
 * This is what separates a standard code generator from a true autonomous software engineer.
 */

import { API_CONFIG, isAPIConfigured } from '../api-config';
import { withSmartRetries } from '../utils';
import type {
  VrikshaState,
  PlanStep,
  UnifiedDiff,
  NodeExecutionResult,
  CodeSymbol,
} from '../langgraph-types';
import { estimateTokens } from '../langgraph-types';
import { extractSymbols, extractChunk, extractSymbolsAST, extractChunkAST } from '../ast-parser';
import { detectLanguage } from '../repo-db';
import { createUnifiedDiff, validatePatch } from '../diff-engine';

// ── System Prompts ───────────────────────────────────────────────────────────

function getCodeEditorPrompt(language: string): string {
  return `**Role:** You are an expert Code Editor Agent specializing in ${language}
**Task:** You will receive a specific code chunk, line numbers, and a change request. Generate a minimal, safe patch.

**Strict Directives:**
1. **Minimal Diff:** Modify ONLY the lines required to fulfill the request. Do not rewrite unrelated code.
2. **Preserve State:** You must preserve all existing imports, formatting, and untouched logic.
3. **Format:** You must output ONLY a valid Unified Diff format. Do not include markdown blocks, explanations, or conversational text.

**Output Schema:**
--- a/<filepath>
+++ b/<filepath>
@@ -<start_line>,<length> +<start_line>,<length> @@
 <unchanged context line>
-<line to remove>
+<line to add>
 <unchanged context line>

**Important:**
- Include 3 lines of context before and after changes
- Use proper line numbers
- Output ONLY the diff, nothing else`;
}

const FILE_GENERATION_PROMPT = `You are an expert code generator. Generate high-quality, production-ready code.

**Guidelines:**
1. Follow best practices for the target language/framework
2. Include proper error handling
3. Add meaningful comments for complex logic
4. Use TypeScript for type safety where applicable
5. Follow AWS Well-Architected principles for infrastructure code

Output ONLY the code, no explanations or markdown blocks.`;

// ── Qwen Coder API ───────────────────────────────────────────────────────────

/**
 * Call Qwen Coder for code editing/generation
 */
async function callQwenCoder(
  systemPrompt: string,
  userMessage: string,
  temperature: number = 0.3
): Promise<string> {
  const { baseUrl, apiKey } = API_CONFIG.qwen;

  if (!apiKey) {
    throw new Error('Qwen API key not configured');
  }

  // List of free Qwen coder models to try in order
  const models = [
    'qwen/qwen3-coder:free',
    'qwen/qwen2.5-coder-32b-instruct',
    'qwen/qwen2.5-72b-instruct',
  ];

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://vriksha.ai',
      'X-Title': 'VRIKSHA.ai',
    },
    body: JSON.stringify({
      models, // OpenRouter will try models in order on failure/rate limit
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature,
      max_tokens: 4096,
    }),
  });

  // Check rate limits (these are for the model that was used)
  const remainingRequests = response.headers.get('x-ratelimit-remaining-requests');
  const remainingTokens = response.headers.get('x-ratelimit-remaining-tokens');
  if (remainingRequests && parseInt(remainingRequests) < 5) {
    console.warn(`[Qwen] Low requests remaining: ${remainingRequests}`);
  }
  if (remainingTokens && parseInt(remainingTokens) < 1000) {
    console.warn(`[Qwen] Low tokens remaining: ${remainingTokens}`);
  }
  if (remainingRequests && parseInt(remainingRequests) === 0) {
    throw new Error('Qwen rate limit exceeded: no requests remaining');
  }
  if (remainingTokens && parseInt(remainingTokens) < 500) {
    throw new Error('Qwen rate limit exceeded: insufficient tokens remaining');
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Qwen API error: ${error}`);
  }

  const data = await response.json();

  // Log usage
  const usage = data.usage;
  if (usage) {
    console.log(`[Qwen] Usage: ${usage.total_tokens} tokens (${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion)`);
  }

  return data.choices[0]?.message?.content || '';
}

/**
 * Fallback to Groq if Qwen is not available
 */
async function callGroqForCode(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const { baseUrl, apiKey, model } = API_CONFIG.groq;

  if (!apiKey) {
    throw new Error('No code generation API configured');
  }

  const response = await fetch(`${baseUrl}/openai/v1/chat/completions`, {
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
      ],
      temperature: 0.3,
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
    console.error('🔍 Detailed Groq API Error (Code Generation):', JSON.stringify(errorDetails, null, 2));
    throw new Error(`Groq API error (${response.status} ${response.statusText}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

// ── Vector Search with Local Nomic Embed ──────────────────────────────────────

/**
 * Get embeddings for code using local Nomic Embed via Transformers.js
 */
async function getCodeEmbedding(code: string): Promise<number[]> {
  try {
    const { pipeline } = await import('@xenova/transformers');
    const embedder = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1');
    const output = await embedder(code);
    return Array.from(output.data) as number[];
  } catch (error) {
    console.warn('Failed to generate local embedding:', error);
    return [];
  }
}

/**
 * Search codebase for relevant files using embeddings
 */
export async function searchCodebase(
  query: string,
  codebase: VrikshaState['codebase'],
  topK: number = 5
): Promise<string[]> {
  const queryEmbedding = await getCodeEmbedding(query);
  
  if (queryEmbedding.length === 0) {
    // Fallback to keyword-based search
    return searchCodebaseKeyword(query, codebase, topK);
  }

  const files = Object.keys(codebase.files);
  const similarities: { file: string; score: number }[] = [];

  for (const file of files) {
    const fileContent = codebase.files[file].content;
    const fileEmbedding = codebase.embeddings?.[file];

    if (fileEmbedding) {
      const score = cosineSimilarity(queryEmbedding, fileEmbedding);
      similarities.push({ file, score });
    } else {
      // Use keyword matching as fallback
      const keywordScore = keywordMatchScore(query, fileContent);
      similarities.push({ file, score: keywordScore });
    }
  }

  similarities.sort((a, b) => b.score - a.score);
  return similarities.slice(0, topK).map(s => s.file);
}

function searchCodebaseKeyword(
  query: string,
  codebase: VrikshaState['codebase'],
  topK: number
): string[] {
  const files = Object.keys(codebase.files);
  const scored = files.map(file => ({
    file,
    score: keywordMatchScore(query, codebase.files[file].content),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map(s => s.file);
}

function keywordMatchScore(query: string, content: string): number {
  const queryWords = query.toLowerCase().split(/\s+/);
  const contentLower = content.toLowerCase();
  let score = 0;
  for (const word of queryWords) {
    if (contentLower.includes(word)) {
      score += 1;
    }
  }
  return score / queryWords.length;
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── AST-Aware Code Editing ───────────────────────────────────────────────────

/**
 * Generate a unified diff for editing existing code
 */
export async function generateCodeEdit(
  filePath: string,
  originalContent: string,
  planStep: PlanStep,
  language: string,
  onStatus?: (msg: string) => void
): Promise<UnifiedDiff> {
  // Extract symbols from the file using tree-sitter AST (falls back to regex)
  const symbols = await extractSymbolsAST(originalContent, language);

  // If we have a target symbol, extract just that chunk with AST precision
  let codeContext = originalContent;
  let lineRange = { start: 1, end: originalContent.split('\n').length };

  if (planStep.symbol) {
    const chunk = await extractChunkAST(originalContent, planStep.symbol, language, 5);
    if (chunk) {
      codeContext = chunk.code;
      lineRange = { start: chunk.startLine, end: chunk.endLine };
    }
  }

  // Build the prompt for Qwen Coder
  let prompt: string;
  let isFullFileEdit = !planStep.symbol;

  if (isFullFileEdit) {
    // For full file edits, generate complete new content instead of diff
    prompt = `File: ${filePath}
Language: ${language}

Current Code:
\`\`\`${language}
${codeContext}
\`\`\`

Change Request: ${planStep.description}
${planStep.rationale ? `Rationale: ${planStep.rationale}` : ''}

Generate the COMPLETE new content for this file after making the requested changes. Return only the code, no explanations or markdown.`;
  } else {
    // For partial edits, generate new code for the chunk
    prompt = `File: ${filePath}
Language: ${language}
Target: ${planStep.symbol}
Lines: ${lineRange.start}-${lineRange.end}

Current Code:
\`\`\`${language}
${codeContext}
\`\`\`

Change Request: ${planStep.description}
${planStep.rationale ? `Rationale: ${planStep.rationale}` : ''}

Generate the new code for this section after making the requested changes. Return only the code, no explanations or markdown.`;
  }

  let output: string | null = null;

  const estimatedTokens = estimateTokens(prompt) + 1500;
  const apiErrors: string[] = [];

  if (isAPIConfigured('qwen')) {
    try {
      output = await withSmartRetries(
        'qwen', estimatedTokens,
        () => callQwenCoder(isFullFileEdit ? getCodeEditorPrompt(language) : FILE_GENERATION_PROMPT, prompt),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Qwen API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  if (!output && isAPIConfigured('groq')) {
    try {
      output = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroqForCode(isFullFileEdit ? getCodeEditorPrompt(language) : FILE_GENERATION_PROMPT, prompt),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Groq API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  // DELETE `generateEditFallback`. Throw error instead.
  if (!output) {
    console.error('🚨 CRITICAL: All code editing APIs failed!');
    console.error('📋 Failed APIs:', apiErrors);
    console.error('💡 Troubleshooting: Check API keys, network connectivity, and rate limits');
    throw new Error(`Failed to generate code edit for ${filePath} due to API rate limits. The pipeline has paused. Click Run to try this step again.`);
  }

  let patched: string;
  let finalDiff: string = '';

  if (isFullFileEdit) {
    // For full file edits, the output is the complete new content
    patched = output.trim();
    // Remove any markdown code blocks if present
    patched = patched.replace(/```(?:\w+)?\n?/g, '').trim();
  } else {
    // For partial edits, replace the chunk with the new code
    let newChunk = output.trim();
    // Remove any markdown code blocks if present
    newChunk = newChunk.replace(/```(?:\w+)?\n?/g, '').trim();
    
    // Replace the chunk in the original content
    const lines = originalContent.split('\n');
    const beforeChunk = lines.slice(0, lineRange.start - 1);
    const afterChunk = lines.slice(lineRange.end);
    const newChunkLines = newChunk.split('\n');
    patched = [...beforeChunk, ...newChunkLines, ...afterChunk].join('\n');
    
    // Generate diff for display
    finalDiff = createUnifiedDiff(filePath, originalContent, patched);
  }

  return {
    filePath,
    originalContent,
    patchedContent: patched,
    diff: finalDiff,
    targetSymbol: planStep.symbol,
    lineRange,
  };
}

/**
 * Generate new file content
 */
export async function generateNewFile(
  filePath: string,
  planStep: PlanStep,
  existingContext?: string,
  onStatus?: (msg: string) => void
): Promise<string> {
  const ext = filePath.split('.').pop() || '';
  const language = getLanguageFromExtension(ext);

  const prompt = `Generate a new ${language} file: ${filePath}

Purpose: ${planStep.description}
${planStep.rationale ? `Rationale: ${planStep.rationale}` : ''}

${existingContext ? `Related Context:\n${existingContext}\n` : ''}

Generate production-ready code following best practices.`;

  let code: string | null = null;

  const estimatedTokens = estimateTokens(prompt) + 2000;
  const apiErrors: string[] = [];

  if (isAPIConfigured('qwen')) {
    try {
      code = await withSmartRetries(
        'qwen', estimatedTokens,
        () => callQwenCoder(FILE_GENERATION_PROMPT, prompt, 0.5),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Qwen API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  if (!code && isAPIConfigured('groq')) {
    try {
      code = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroqForCode(FILE_GENERATION_PROMPT, prompt),
        onStatus
      );
    } catch (e) {
      const errorMsg = `Groq API failed: ${e instanceof Error ? e.message : String(e)}`;
      console.error(`❌ ${errorMsg}`);
      apiErrors.push(errorMsg);
    }
  }

  if (!code) {
    console.error('🚨 CRITICAL: All code generation APIs failed!');
    console.error('📋 Failed APIs:', apiErrors);
    console.error('💡 Troubleshooting: Check API keys, network connectivity, and rate limits');
    throw new Error(`Failed to generate new file ${filePath} due to API rate limits. The pipeline has paused. Click Run to try this step again.`);
  }

  // Clean up the output (remove markdown blocks if present)
  return cleanCodeOutput(code);
}

// ── Utility Functions ────────────────────────────────────────────────────────

function cleanCodeOutput(code: string): string {
  // Remove markdown code blocks
  return code.replace(/```[\w]*\n?/g, '').trim();
}

function getLanguageFromExtension(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    py: 'python',
    tf: 'hcl',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    md: 'markdown',
  };
  return map[ext] || ext;
}

// ── Node Execution ───────────────────────────────────────────────────────────

/**
 * Execute the Code Editor Node
 */
export async function executeCodeEditorNode(
  state: VrikshaState,
  onStatus?: (msg: string) => void
): Promise<NodeExecutionResult> {
  try {
    const { plan, currentStepIndex, codebase } = state;

    if (!plan || currentStepIndex >= plan.steps.length) {
      return {
        success: true,
        nextNode: 'reflection',
        stateUpdates: {},
      };
    }

    const step = plan.steps[currentStepIndex];
    let diff: UnifiedDiff | undefined = undefined;
    let tokensUsed = 0;

    if (step.action === 'edit') {
      // Edit existing file
      const file = codebase.files[step.file];
      if (file) {
        diff = await generateCodeEdit(step.file, file.content, step, file.language, onStatus);
        tokensUsed = estimateTokens(file.content) + estimateTokens(diff.patchedContent);
      } else {
        // File doesn't exist, create it instead
        const content = await generateNewFile(step.file, step, undefined, onStatus);
        diff = {
          filePath: step.file,
          originalContent: '',
          patchedContent: content,
          diff: createUnifiedDiff(step.file, '', content),
          lineRange: { start: 1, end: content.split('\n').length },
        };
        tokensUsed = estimateTokens(content);
      }
    } else if (step.action === 'create') {
      // Create new file
      const content = await generateNewFile(step.file, step, undefined, onStatus);
      diff = {
        filePath: step.file,
        originalContent: '',
        patchedContent: content,
        diff: createUnifiedDiff(step.file, '', content),
        lineRange: { start: 1, end: content.split('\n').length },
      };
      tokensUsed = estimateTokens(content);
    }

    // Mark step as completed
    const updatedPlan = {
      ...plan,
      steps: plan.steps.map((s, i) =>
        i === currentStepIndex ? { ...s, completed: true, diff } : s
      ),
    };

    // Determine next node
    const nextStepIndex = currentStepIndex + 1;
    const hasMoreSteps = nextStepIndex < plan.steps.length;
    const nextStep = hasMoreSteps ? plan.steps[nextStepIndex] : null;

    let nextNode: VrikshaState['currentNode'] = 'reflection';
    if (hasMoreSteps) {
      nextNode = nextStep?.action === 'search' ? 'retrieval' : 'editing';
    }

    return {
      success: true,
      nextNode,
      stateUpdates: {
        plan: updatedPlan,
        currentStepIndex: nextStepIndex,
        pendingDiffs: diff ? [...state.pendingDiffs, diff] : state.pendingDiffs,
        tokensUsed: state.tokensUsed + tokensUsed,
      },
      userMessage: diff
        ? `Generated ${step.action === 'create' ? 'new file' : 'edit'} for \`${step.file}\``
        : undefined,
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
