/**
 * code-editor-agent.ts — Node 3: AST-Aware Code Editor (The Builder)
 * 
 * Process:
 * 1. Retrieval: Nomic Embed Code performs vector search over generated files
 * 2. Localization: Tree-sitter AST parser isolates exact function/resource block
 * 3. Patch Generation: Qwen Coder outputs strict Unified Diff format
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
import { createUnifiedDiff, applyPatch as applyUnifiedPatch, validatePatch } from '../diff-engine';

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
  const { baseUrl, apiKey, model } = API_CONFIG.qwen;

  if (!apiKey) {
    throw new Error('Qwen API key not configured');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://vriksha.ai',
      'X-Title': 'VRIKSHA.ai',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Qwen API error: ${error}`);
  }

  const data = await response.json();
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
      ],
      temperature: 0.3,
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

// ── Vector Search with Nomic ─────────────────────────────────────────────────

/**
 * Get embeddings for code using Nomic Embed Code
 */
async function getCodeEmbedding(code: string): Promise<number[]> {
  const { baseUrl, apiKey, model } = API_CONFIG.nomic;

  if (!apiKey) {
    return []; // Return empty if not configured
  }

  try {
    const response = await fetch(`${baseUrl}/embedding/text`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        texts: [code],
        task_type: 'search_document',
      }),
    });

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return data.embeddings?.[0] || [];
  } catch {
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
  const prompt = `File: ${filePath}
Language: ${language}
Target: ${planStep.symbol || 'entire file'}
Lines: ${lineRange.start}-${lineRange.end}

Current Code:
\`\`\`${language}
${codeContext}
\`\`\`

Change Request: ${planStep.description}
${planStep.rationale ? `Rationale: ${planStep.rationale}` : ''}

Generate a unified diff to make this change. Include 3 lines of context.`;

  let diffOutput: string | null = null;

  const estimatedTokens = estimateTokens(prompt) + 1500;

  if (isAPIConfigured('qwen')) {
    try {
      diffOutput = await withSmartRetries(
        'qwen', estimatedTokens,
        () => callQwenCoder(getCodeEditorPrompt(language), prompt),
        onStatus
      );
    } catch (e) {
      console.warn('Qwen API exhausted retries...', e);
    }
  }

  if (!diffOutput && isAPIConfigured('groq')) {
    try {
      diffOutput = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroqForCode(getCodeEditorPrompt(language), prompt),
        onStatus
      );
    } catch (e) {
      console.warn('Groq API exhausted retries...', e);
    }
  }

  // DELETE `generateEditFallback`. Throw error instead.
  if (!diffOutput) {
    throw new Error(`Failed to generate code edit for ${filePath} due to API rate limits. The pipeline has paused. Click Run to try this step again.`);
  }

  // Parse the diff output
  const cleanDiff = cleanDiffOutput(diffOutput, filePath);

  // Apply the diff to get patched content
  const patched = applyUnifiedPatch(originalContent, cleanDiff);
  if (patched === null) {
    throw new Error(`Failed to apply generated diff for ${filePath}. The diff format may be invalid.`);
  }

  return {
    filePath,
    originalContent,
    patchedContent: patched,
    diff: cleanDiff,
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

  if (isAPIConfigured('qwen')) {
    try {
      code = await withSmartRetries(
        'qwen', estimatedTokens,
        () => callQwenCoder(FILE_GENERATION_PROMPT, prompt, 0.5),
        onStatus
      );
    } catch (e) {
      console.warn('Qwen API exhausted retries for new file...', e);
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
      console.warn('Groq API exhausted retries for new file...', e);
    }
  }

  if (!code) {
    throw new Error(`Failed to generate new file ${filePath} due to API rate limits. The pipeline has paused. Click Run to try this step again.`);
  }

  // Clean up the output (remove markdown blocks if present)
  return cleanCodeOutput(code);
}

// ── Utility Functions ────────────────────────────────────────────────────────

function cleanDiffOutput(output: string, filePath: string): string {
  // Remove markdown code blocks
  let cleaned = output.replace(/```(?:diff)?\n?/g, '').trim();

  // Ensure proper diff headers
  if (!cleaned.startsWith('---')) {
    cleaned = `--- a/${filePath}\n+++ b/${filePath}\n${cleaned}`;
  }

  return cleaned;
}

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
