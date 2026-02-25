/**
 * agent-store.ts — Zustand store for the autonomous Planner → Coder → Reflector agent loop.
 *
 * This runs entirely in the browser. In production you'd wire the LLM calls
 * to Amazon Bedrock / Qwen / etc.  Here we provide the full loop skeleton
 * with a pluggable "provider" so you can swap in real API calls later.
 */

import { create } from "zustand";
import { readFile, saveFile, listFiles } from "@/lib/repo-db";
import { extractSymbols, extractChunk, type CodeSymbol } from "@/lib/ast-parser";
import { createUnifiedDiff, applyPatch, validatePatch, diffStats } from "@/lib/diff-engine";
import { detectLanguage } from "@/lib/repo-db";
import { searchFiles } from "@/lib/search-engine";

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

export interface AgentState {
  // Status
  running: boolean;
  currentNode: AgentNodeId;
  steps: AgentStep[];
  plan: AgentPlan | null;
  error: string | null;

  // Conversation-like history for the agent panel
  messages: AgentMessage[];

  // Statistics
  totalEdits: number;
  totalDiffs: number;
  tokensUsed: number;

  // Actions
  runAgent: (goal: string) => Promise<void>;
  stopAgent: () => void;
  clearHistory: () => void;
  addMessage: (role: "user" | "agent" | "system", text: string) => void;
  applySuggestedDiff: (stepId: string) => Promise<void>;
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

// ── Utility ──────────────────────────────────────────────────────────────────

let abortController: AbortController | null = null;

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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

  // ── Main Agent Loop ──────────────────────────────────────────────────────

  runAgent: async (goal: string) => {
    abortController = new AbortController();
    const signal = abortController.signal;

    set({
      running: true,
      currentNode: "planning",
      error: null,
      plan: null,
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

      // ─── Node 1: Planning ──────────────────────────────────────
      addStep("planning", "Analyzing goal and building plan…");
      addMsg("agent", `🧠 **Planning:** Analyzing "${goal}"…`);
      await delay(800, signal);

      const plan = await buildPlan(goal, signal);
      set({ plan });
      set((s) => ({ tokensUsed: s.tokensUsed + estimateTokens(goal) }));

      addMsg(
        "agent",
        `📋 **Plan created** (${plan.steps.length} steps):\n${plan.steps
          .map((s, i) => `  ${i + 1}. **${s.action}** \`${s.file}\`${s.symbol ? ` → \`${s.symbol}\`` : ""} — ${s.description}`)
          .join("\n")}`,
      );

      // ─── Execute each step ─────────────────────────────────────
      for (const planStep of plan.steps) {
        if (signal.aborted) break;

        switch (planStep.action) {
          case "search": {
            addStep("searching", `Searching for: ${planStep.description}`);
            addMsg("agent", `🔍 **Searching** codebase for context on \`${planStep.file}\`…`);
            await delay(600, signal);

            const results = await searchFiles(planStep.description, 5);
            if (results.length > 0) {
              addMsg(
                "agent",
                `Found ${results.length} matches:\n${results
                  .slice(0, 3)
                  .map((r) => `  • \`${r.path}:${r.line}\` — ${r.text.slice(0, 80)}`)
                  .join("\n")}`,
              );
            } else {
              addMsg("agent", "No matches found in the current codebase.");
            }
            break;
          }

          case "edit": {
            addStep("editing", `Editing ${planStep.file}`, planStep.description);
            addMsg("agent", `⚡ **AST Edit:** Targeting \`${planStep.file}\`${planStep.symbol ? ` → \`${planStep.symbol}\`` : ""}…`);
            await delay(700, signal);

            const fileContent = await readFile(planStep.file);
            if (!fileContent) {
              addMsg("agent", `⚠️ File \`${planStep.file}\` not found — creating it.`);
              const newContent = generateNewFileContent(planStep);
              await saveFile(planStep.file, newContent);
              addMsg("agent", `✅ Created \`${planStep.file}\``);
              set((s) => ({ totalEdits: s.totalEdits + 1 }));
              break;
            }

            // AST extraction
            const lang = detectLanguage(planStep.file);
            const symbols = extractSymbols(fileContent, lang);
            if (symbols.length > 0) {
              addMsg(
                "agent",
                `📊 AST parsed: ${symbols.length} symbols found — ${symbols.map((s) => `\`${s.name}\``).join(", ")}`,
              );
            }

            // Generate the edit
            const editResult = generateEdit(
              fileContent,
              planStep,
              symbols,
              lang,
            );

            const diffText = createUnifiedDiff(
              planStep.file,
              fileContent,
              editResult.newContent,
            );

            const stats = diffStats(diffText);
            const step = addStep("editing", `Generated diff for ${planStep.file}`, diffText, {
              diff: diffText,
              targetFile: planStep.file,
              targetSymbol: planStep.symbol,
            });

            set((s) => ({
              totalDiffs: s.totalDiffs + 1,
              tokensUsed: s.tokensUsed + estimateTokens(editResult.newContent),
            }));

            addMsg(
              "agent",
              `📝 **Diff generated** for \`${planStep.file}\`: +${stats.additions} −${stats.deletions} lines`,
            );

            // ─── Reflection ────────────────────────────────────
            addStep("reflecting", `Verifying patch for ${planStep.file}`);
            addMsg("agent", `🔍 **Reflecting:** Validating patch syntax and semantics…`);
            await delay(500, signal);

            const valid = validatePatch(fileContent, diffText);
            if (valid) {
              addMsg("agent", `✅ Patch verified — ready to apply.`);

              // Auto-apply
              addStep("applying", `Applying patch to ${planStep.file}`);
              const patched = applyPatch(fileContent, diffText);
              if (patched !== null) {
                await saveFile(planStep.file, patched);
                addMsg("agent", `✅ **Applied** patch to \`${planStep.file}\``);
                set((s) => ({ totalEdits: s.totalEdits + 1 }));
              } else {
                addMsg("agent", `⚠️ Patch application failed — diff saved for manual review.`);
              }
            } else {
              addMsg("agent", `⚠️ Patch validation failed — retrying with direct edit…`);
              // Fallback: direct write
              await saveFile(planStep.file, editResult.newContent);
              addMsg("agent", `✅ Direct edit applied to \`${planStep.file}\``);
              set((s) => ({ totalEdits: s.totalEdits + 1 }));
            }
            break;
          }

          case "create": {
            addStep("editing", `Creating ${planStep.file}`);
            addMsg("agent", `📄 **Creating** \`${planStep.file}\`…`);
            await delay(500, signal);

            const content = generateNewFileContent(planStep);
            await saveFile(planStep.file, content);
            addMsg("agent", `✅ Created \`${planStep.file}\` (${content.split("\n").length} lines)`);
            set((s) => ({ totalEdits: s.totalEdits + 1 }));
            break;
          }

          case "delete": {
            // We just report — don't actually delete without user confirmation
            addStep("editing", `Flagged ${planStep.file} for deletion`);
            addMsg("agent", `🗑️ Flagged \`${planStep.file}\` for deletion. Confirm in the file tree.`);
            break;
          }
        }
      }

      // ─── Done ──────────────────────────────────────────────────
      addStep("done", "Agent loop completed");
      addMsg(
        "agent",
        `🎉 **Done!** Completed ${plan.steps.length} operations. ${get().totalEdits} files modified, ${get().totalDiffs} diffs generated.`,
      );
      set({ running: false, currentNode: "done" });
    } catch (err: unknown) {
      if (signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      set({ running: false, currentNode: "error", error: message });
      addMsg("system", `❌ Error: ${message}`);
    }
  },
}));

// ── Local Planning (simulated — replace with real LLM) ──────────────────────

async function buildPlan(goal: string, signal: AbortSignal): Promise<AgentPlan> {
  await delay(400, signal);

  const lower = goal.toLowerCase();
  const files = await listFiles();
  const steps: PlanStep[] = [];

  // Intelligent plan generation based on goal keywords
  if (lower.includes("database") || lower.includes("dynamo") || lower.includes("highly available") || lower.includes("replica")) {
    const tfFile = files.find((f) => f.includes("dynamodb")) ?? "dynamodb.tf";
    steps.push(
      { action: "search", file: "*", description: "DynamoDB configuration", symbol: undefined },
      { action: "edit", file: tfFile, symbol: "aws_dynamodb_table", description: "Add cross-region replica for high availability" },
    );
  } else if (lower.includes("api") || lower.includes("rest") || lower.includes("endpoint")) {
    steps.push(
      { action: "create", file: "src/api/handler.ts", description: "Create API route handler" },
      { action: "create", file: "src/api/middleware.ts", description: "Create request middleware" },
      { action: "edit", file: "lambda.tf", description: "Wire Lambda to API Gateway" },
    );
  } else if (lower.includes("ecommerce") || lower.includes("e-commerce") || lower.includes("shop")) {
    steps.push(
      { action: "create", file: "src/pages/index.tsx", description: "Create storefront page" },
      { action: "create", file: "src/components/ProductCard.tsx", description: "Create product card component" },
      { action: "create", file: "dynamodb.tf", description: "Create products table" },
      { action: "create", file: "lambda.tf", description: "Create serverless functions" },
    );
  } else if (lower.includes("test") || lower.includes("spec")) {
    const srcFiles = files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const f of srcFiles.slice(0, 3)) {
      steps.push({
        action: "create",
        file: f.replace(/\.(ts|tsx)$/, ".test.$1"),
        description: `Generate tests for ${f}`,
      });
    }
  } else if (lower.includes("deploy") || lower.includes("ci") || lower.includes("cd")) {
    steps.push(
      { action: "create", file: "main.tf", description: "Create main Terraform config with VPC" },
      { action: "create", file: "variables.tf", description: "Create Terraform variables" },
      { action: "create", file: "outputs.tf", description: "Create Terraform outputs" },
    );
  } else if (lower.includes("refactor") || lower.includes("clean")) {
    for (const f of files.slice(0, 3)) {
      steps.push({
        action: "edit",
        file: f,
        description: `Refactor and clean up ${f}`,
      });
    }
  } else {
    // Generic: create a file related to the goal
    const filename = lower.replace(/[^a-z0-9]+/g, "-").slice(0, 30);
    steps.push(
      { action: "search", file: "*", description: goal },
      { action: "create", file: `src/${filename}.ts`, description: goal },
    );
  }

  return { goal, steps };
}

// ── Edit Generation (simulated — replace with Qwen Coder) ──────────────────

function generateEdit(
  originalContent: string,
  planStep: PlanStep,
  symbols: CodeSymbol[],
  language: string,
): { newContent: string; description: string } {
  const lines = originalContent.split("\n");

  // Try to find the target symbol via AST
  if (planStep.symbol) {
    const chunk = extractChunk(originalContent, planStep.symbol, language, 5);
    if (chunk) {
      // Simulate a targeted edit on just this symbol
      const editedCode = applySimulatedEdit(chunk.code, planStep.description);
      const newLines = [...lines];
      const start = chunk.startLine - 1;
      const end = chunk.endLine - 1;
      newLines.splice(start, end - start + 1, ...editedCode.split("\n"));
      return {
        newContent: newLines.join("\n"),
        description: `Edited symbol ${planStep.symbol} at lines ${chunk.startLine}-${chunk.endLine}`,
      };
    }
  }

  // Fallback: append to end of file
  const comment = language === "python" ? "#" : language === "hcl" ? "#" : "//";
  const addition = `\n${comment} --- Agent edit: ${planStep.description} ---\n${comment} TODO: Implement ${planStep.description}\n`;
  return {
    newContent: originalContent + addition,
    description: `Appended edit note for: ${planStep.description}`,
  };
}

function applySimulatedEdit(code: string, description: string): string {
  const lower = description.toLowerCase();

  if (lower.includes("replica") || lower.includes("high availability") || lower.includes("multi-region")) {
    // Add replica block for Terraform
    if (code.includes("resource") && code.includes("dynamodb")) {
      const closingBrace = code.lastIndexOf("}");
      if (closingBrace > -1) {
        return (
          code.slice(0, closingBrace) +
          '\n  # Cross-region High Availability replica\n  replica {\n    region_name = "us-east-2"\n  }\n\n' +
          code.slice(closingBrace)
        );
      }
    }
  }

  if (lower.includes("add") || lower.includes("create")) {
    // Generic: add a comment + placeholder
    return code + `\n\n  # Agent: ${description}\n  # TODO: Implement\n`;
  }

  // Default: return code with a comment header
  return `# Modified by VRIKSHA Agent: ${description}\n${code}`;
}

// ── New File Generation ─────────────────────────────────────────────────────

function generateNewFileContent(planStep: PlanStep): string {
  const ext = planStep.file.split(".").pop() ?? "";

  if (ext === "tf") {
    return generateTerraformFile(planStep);
  }
  if (ext === "ts" || ext === "tsx") {
    return generateTypeScriptFile(planStep);
  }
  if (ext === "py") {
    return generatePythonFile(planStep);
  }

  return `# Generated by VRIKSHA.ai Agent\n# ${planStep.description}\n\n# TODO: Implement\n`;
}

function generateTerraformFile(step: PlanStep): string {
  const name = step.file.replace(".tf", "").replace(/[^a-z0-9]/gi, "_");

  if (step.file.includes("dynamodb")) {
    return `# Generated by VRIKSHA.ai Agent 🌿
# ${step.description}

resource "aws_dynamodb_table" "${name}" {
  name           = "vriksha-${name}"
  billing_mode   = "PAY_PER_REQUEST"
  hash_key       = "id"
  range_key      = "createdAt"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = {
    Name    = "vriksha-${name}"
    Project = "VRIKSHA.ai"
  }
}
`;
  }

  if (step.file.includes("lambda")) {
    return `# Generated by VRIKSHA.ai Agent 🌿
# ${step.description}

resource "aws_lambda_function" "${name}" {
  filename         = "dist/handler.zip"
  function_name    = "vriksha-${name}"
  role             = aws_iam_role.lambda_role.arn
  handler          = "index.handler"
  source_code_hash = filebase64sha256("dist/handler.zip")
  runtime          = "nodejs20.x"
  timeout          = 30
  memory_size      = 512

  environment {
    variables = {
      NODE_OPTIONS = "--enable-source-maps"
    }
  }

  tracing_config {
    mode = "Active"
  }
}

resource "aws_iam_role" "lambda_role" {
  name = "vriksha-${name}-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}
`;
  }

  return `# Generated by VRIKSHA.ai Agent 🌿
# ${step.description}

provider "aws" {
  region = var.aws_region
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name    = "vriksha-vpc"
    Project = "VRIKSHA.ai"
  }
}

variable "aws_region" {
  default = "ap-south-1"
}

variable "environment" {
  default = "production"
}

output "vpc_id" {
  value = aws_vpc.main.id
}
`;
}

function generateTypeScriptFile(step: PlanStep): string {
  if (step.file.includes("component") || step.file.includes("Component") || step.file.endsWith(".tsx")) {
    const name = step.file
      .split("/")
      .pop()!
      .replace(/\.(tsx|ts)$/, "");
    return `/**
 * ${name} — Generated by VRIKSHA.ai Agent 🌿
 * ${step.description}
 */

"use client";

import { useState } from "react";

interface ${name}Props {
  // TODO: Define props
}

export default function ${name}({}: ${name}Props) {
  const [loading, setLoading] = useState(false);

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold">${name}</h2>
      {/* TODO: Implement ${step.description} */}
    </div>
  );
}
`;
  }

  return `/**
 * Generated by VRIKSHA.ai Agent 🌿
 * ${step.description}
 */

export async function handler(event: unknown) {
  // TODO: Implement ${step.description}
  console.log("Handler invoked", event);

  return {
    statusCode: 200,
    body: JSON.stringify({ message: "OK" }),
  };
}
`;
}

function generatePythonFile(step: PlanStep): string {
  return `"""
Generated by VRIKSHA.ai Agent 🌿
${step.description}
"""

from typing import Any


def handler(event: dict[str, Any]) -> dict[str, Any]:
    """${step.description}"""
    # TODO: Implement
    return {"statusCode": 200, "body": "OK"}


if __name__ == "__main__":
    result = handler({})
    print(result)
`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
