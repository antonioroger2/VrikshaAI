/**
 * reflection-agent.ts — Node 4: Reflection & Documentation Agent
 * 
 * Process:
 * 1. Code Review: Gemini 3.1 Pro evaluates patched codebase for AWS Well-Architected best practices
 * 2. If diff fails, loop back to Node 3 (Code Editor)
 * 3. Samjhao Layer: Generate explanation in user's native language
 * 4. Documentation: Create standard English deployment documentation
 */

import { API_CONFIG, isAPIConfigured, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../api-config';
import { withSmartRetries } from '../utils';
import type {
  VrikshaState,
  UnifiedDiff,
  PatchResult,
  NodeExecutionResult,
} from '../langgraph-types';
import { estimateTokens } from '../langgraph-types';
import { validatePatch, applyPatch } from '../diff-engine';
import { translate } from '../translation-service';

// ── System Prompts ───────────────────────────────────────────────────────────

const CODE_REVIEW_PROMPT = `You are an expert code reviewer specializing in AWS infrastructure and application code.

**Your Task:**
Review the provided code changes and verify:
1. **Syntax Validity**: The code is syntactically correct
2. **AWS Well-Architected**: Follows the 6 pillars (Security, Reliability, Performance, Cost, Operations, Sustainability)
3. **Best Practices**: Uses recommended patterns for the language/framework
4. **No Regressions**: The change doesn't break existing functionality

**Output Format (JSON):**
{
  "valid": true | false,
  "issues": [
    {
      "severity": "error" | "warning" | "info",
      "line": 10,
      "message": "Description of the issue",
      "suggestion": "How to fix it"
    }
  ],
  "wellArchitectedScore": 0-100,
  "pillars": {
    "security": 0-100,
    "reliability": 0-100,
    "performance": 0-100,
    "cost": 0-100,
    "operations": 0-100,
    "sustainability": 0-100
  },
  "summary": "Brief summary of the review"
}`;

const SAMJHAO_PROMPT = `You are a technical educator who explains complex cloud architecture concepts in simple terms in {LANGUAGE}.

**Your Task:**
Explain the following code changes and architectural decisions to someone learning cloud development.
Use analogies and simple language. Keep technical terms in English but explain them.

**Guidelines:**
1. Use the native language {LANGUAGE_NATIVE} for explanations
2. Keep AWS/technical terms in English (e.g., "Lambda", "DynamoDB", "API Gateway")
3. Use relatable analogies (e.g., "Lambda is like a chef who only cooks when you order")
4. Explain WHY each decision was made, not just WHAT it does
5. Include a "Key Takeaways" section at the end

Output the explanation in markdown format.`;

const DEPLOYMENT_DOCS_PROMPT = `Generate professional deployment documentation in English for the following infrastructure code.

**Include:**
1. Overview of the architecture
2. Prerequisites (AWS CLI, Terraform, etc.)
3. Step-by-step deployment instructions
4. Environment variables needed
5. Post-deployment verification steps
6. Rollback instructions
7. Monitoring and logging setup

Output in markdown format with proper code blocks.`;

// ── Gemini API ───────────────────────────────────────────────────────────────

/**
 * Call Google Gemini for code review and documentation
 */
async function callGemini(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const { baseUrl, apiKey, model } = API_CONFIG.gemini;

  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  const response = await fetch(
    `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt + '\n\n' + userMessage },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 4096,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${error}`);
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

/**
 * Fallback to Groq for code review
 */
async function callGroqForReview(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const { baseUrl, apiKey, model } = API_CONFIG.groq;

  if (!apiKey) {
    throw new Error('No review API configured');
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
      temperature: 0.5,
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

// ── Code Review ──────────────────────────────────────────────────────────────

export interface CodeReviewResult {
  valid: boolean;
  issues: {
    severity: 'error' | 'warning' | 'info';
    line?: number;
    message: string;
    suggestion?: string;
  }[];
  wellArchitectedScore: number;
  pillars: {
    security: number;
    reliability: number;
    performance: number;
    cost: number;
    operations: number;
    sustainability: number;
  };
  summary: string;
}

/**
 * Review code changes for best practices and errors
 */
export async function reviewCode(
  diff: UnifiedDiff,
  onStatus?: (msg: string) => void
): Promise<CodeReviewResult> {
  const prompt = `Review this code change:

File: ${diff.filePath}
Target Symbol: ${diff.targetSymbol || 'entire file'}
Lines: ${diff.lineRange.start}-${diff.lineRange.end}

Diff:
\`\`\`diff
${diff.diff}
\`\`\`

New Content:
\`\`\`
${diff.patchedContent}
\`\`\``;

  let response: string | null = null;

  const estimatedTokens = estimateTokens(diff.diff + diff.patchedContent) + 500;

  if (isAPIConfigured('gemini')) {
    try {
      response = await withSmartRetries(
        'gemini', estimatedTokens,
        () => callGemini(CODE_REVIEW_PROMPT, prompt),
        onStatus
      );
    } catch (e) {
      console.warn('Gemini API exhausted retries...', e);
    }
  }

  if (!response && isAPIConfigured('groq')) {
    try {
      response = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroqForReview(CODE_REVIEW_PROMPT, prompt),
        onStatus
      );
    } catch (e) {
      console.warn('Groq API exhausted retries...', e);
    }
  }

  if (!response) {
    throw new Error(`Failed to review code changes for ${diff.filePath} due to API rate limits. The pipeline has paused. Click Run to try this step again.`);
  }

  // Parse JSON response
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      valid: parsed.valid ?? true,
      issues: parsed.issues || [],
      wellArchitectedScore: parsed.wellArchitectedScore ?? 80,
      pillars: parsed.pillars || {
        security: 80,
        reliability: 80,
        performance: 80,
        cost: 80,
        operations: 80,
        sustainability: 80,
      },
      summary: parsed.summary || 'Code review completed.',
    };
  }

  throw new Error(`Invalid response format from code review API for ${diff.filePath}.`);
}

// ── Samjhao Documentation ────────────────────────────────────────────────────

/**
 * Generate "Samjhao" (explanation) documentation in user's language
 */
export async function generateSamjhao(
  state: VrikshaState,
  onStatus?: (msg: string) => void
): Promise<string> {
  const { pendingDiffs, inputLanguage, plan } = state;

  if (pendingDiffs.length === 0) {
    return '';
  }

  const languageInfo = SUPPORTED_LANGUAGES[inputLanguage];
  const prompt = SAMJHAO_PROMPT
    .replace('{LANGUAGE}', languageInfo.name)
    .replace('{LANGUAGE_NATIVE}', languageInfo.nativeName);

  const changesDescription = pendingDiffs
    .map(d => `File: ${d.filePath}\nChanges:\n${d.diff}`)
    .join('\n\n---\n\n');

  const userPrompt = `Goal: ${plan?.goal || 'Infrastructure changes'}

Changes Made:
${changesDescription}

Please explain these changes in ${languageInfo.nativeName}.`;

  let samjhao: string | null = null;

  const estimatedTokens = estimateTokens(userPrompt) + 1000;

  if (isAPIConfigured('gemini')) {
    try {
      samjhao = await withSmartRetries(
        'gemini', estimatedTokens,
        () => callGemini(prompt, userPrompt),
        onStatus
      );
    } catch (e) {
      console.warn('Gemini API exhausted retries for Samjhao...', e);
    }
  }

  if (!samjhao && isAPIConfigured('groq')) {
    try {
      samjhao = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroqForReview(prompt, userPrompt),
        onStatus
      );
    } catch (e) {
      console.warn('Groq API exhausted retries for Samjhao...', e);
    }
  }

  if (!samjhao) {
    throw new Error("Failed to generate explanation due to API rate limits. Please try again.");
  }

  return samjhao;
}

// ── Deployment Documentation ─────────────────────────────────────────────────

/**
 * Generate deployment documentation in English
 */
export async function generateDeploymentDocs(
  state: VrikshaState,
  onStatus?: (msg: string) => void
): Promise<string> {
  const { pendingDiffs, plan, codebase } = state;

  const filesContext = pendingDiffs
    .map(d => `### ${d.filePath}\n\`\`\`\n${d.patchedContent}\n\`\`\``)
    .join('\n\n');

  const prompt = `Architecture Goal: ${plan?.goal || 'Infrastructure Deployment'}

Files to Deploy:
${Object.keys(codebase.files).join('\n')}

New/Modified Files:
${filesContext}`;

  let docs: string | null = null;

  const estimatedTokens = estimateTokens(prompt) + 1500;

  if (isAPIConfigured('gemini')) {
    try {
      docs = await withSmartRetries(
        'gemini', estimatedTokens,
        () => callGemini(DEPLOYMENT_DOCS_PROMPT, prompt),
        onStatus
      );
    } catch (e) {
      console.warn('Gemini API exhausted retries for deployment docs...', e);
    }
  }

  if (!docs && isAPIConfigured('groq')) {
    try {
      docs = await withSmartRetries(
        'groq', estimatedTokens,
        () => callGroqForReview(DEPLOYMENT_DOCS_PROMPT, prompt),
        onStatus
      );
    } catch (e) {
      console.warn('Groq API exhausted retries for deployment docs...', e);
    }
  }

  if (!docs) {
    throw new Error("Failed to generate deployment documentation due to API rate limits. Please try again.");
  }

  return docs;
}

// ── Apply Patches ────────────────────────────────────────────────────────────

/**
 * Apply all pending diffs to the codebase
 */
export async function applyPendingDiffs(
  state: VrikshaState
): Promise<{ codebase: VrikshaState['codebase']; results: PatchResult[] }> {
  const results: PatchResult[] = [];
  const updatedFiles = { ...state.codebase.files };

  for (const diff of state.pendingDiffs) {
    // Validate the patch first
    const isValid = validatePatch(diff.originalContent, diff.diff);

    if (isValid || diff.originalContent === '') {
      // Apply the patch
      updatedFiles[diff.filePath] = {
        path: diff.filePath,
        content: diff.patchedContent,
        language: getLanguageFromPath(diff.filePath),
        lastModified: Date.now(),
      };

      results.push({
        success: true,
        filePath: diff.filePath,
        syntaxValid: true,
      });
    } else {
      results.push({
        success: false,
        filePath: diff.filePath,
        error: 'Patch validation failed',
        syntaxValid: false,
      });
    }
  }

  return {
    codebase: {
      ...state.codebase,
      files: updatedFiles,
      lastIndexed: Date.now(),
    },
    results,
  };
}

function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop() || '';
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    tf: 'hcl',
    py: 'python',
    json: 'json',
    yaml: 'yaml',
    md: 'markdown',
  };
  return map[ext] || 'plaintext';
}

// ── Node Execution ───────────────────────────────────────────────────────────

/**
 * Execute the Reflection Node
 */
export async function executeReflectionNode(
  state: VrikshaState,
  onStatus?: (msg: string) => void
): Promise<NodeExecutionResult> {
  try {
    const { pendingDiffs } = state;

    if (pendingDiffs.length === 0) {
      return {
        success: true,
        nextNode: 'responding',
        stateUpdates: {},
        userMessage: 'No changes to review.',
      };
    }

    // Review each diff
    const reviews: CodeReviewResult[] = [];
    let allValid = true;
    let tokensUsed = 0;

    for (const diff of pendingDiffs) {
      const review = await reviewCode(diff, onStatus);
      reviews.push(review);
      tokensUsed += estimateTokens(diff.diff) + 500;

      if (!review.valid) {
        allValid = false;
      }
    }

    // If any review failed, loop back to editor
    if (!allValid) {
      const failedReviews = reviews.filter(r => !r.valid);
      const errorMessage = failedReviews
        .flatMap(r => r.issues.filter(i => i.severity === 'error'))
        .map(i => i.message)
        .join('\n');

      return {
        success: false,
        nextNode: 'editing',
        stateUpdates: {
          error: `Code review failed:\n${errorMessage}`,
          tokensUsed: state.tokensUsed + tokensUsed,
        },
        userMessage: `⚠️ Code review found issues. Retrying edit...`,
      };
    }

    // All reviews passed - apply patches
    const { codebase, results } = await applyPendingDiffs(state);

    // Generate documentation in parallel
    const [samjhaoMarkdown, deploymentDocs] = await Promise.all([
      generateSamjhao(state, onStatus),
      generateDeploymentDocs(state, onStatus),
    ]);

    tokensUsed += estimateTokens(samjhaoMarkdown) + estimateTokens(deploymentDocs);

    // Calculate average Well-Architected score
    const avgScore = Math.round(
      reviews.reduce((sum, r) => sum + r.wellArchitectedScore, 0) / reviews.length
    );

    return {
      success: true,
      nextNode: 'responding',
      stateUpdates: {
        codebase,
        appliedPatches: results,
        pendingDiffs: [],
        samjhaoMarkdown,
        deploymentDocs,
        architecture: {
          ...state.architecture,
          wellArchitectedScore: avgScore,
          lastUpdated: Date.now(),
        },
        tokensUsed: state.tokensUsed + tokensUsed,
      },
      userMessage: `✅ Code review passed! Well-Architected Score: ${avgScore}/100\n\n${results.length} file(s) updated successfully.`,
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
