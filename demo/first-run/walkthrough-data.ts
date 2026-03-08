export interface WalkthroughModule {
  label: string;
  file: string;
  note: string;
}

export interface WalkthroughStep {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  highlights: string[];
  modules: WalkthroughModule[];
  builderFlow?: string[];
  spotlight?: {
    selector: string;
    position: 'top' | 'bottom' | 'left' | 'right' | 'center';
    text?: string;
  };
}

export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: "overview",
    eyebrow: "Platform Overview",
    title: "This repo is an agentic AWS build studio, not just a chat shell",
    summary:
      "VRIKSHA combines a voice-first assistant, a real Monaco editor, browser-side repo storage, and a multi-step orchestration loop that can plan, retrieve, edit, review, and explain code.",
    highlights: [
      "Voice input and multilingual chat are first-class citizens.",
      "The editor is live, stateful, and backed by browser persistence.",
      "The product is designed around AWS architecture generation and review.",
    ],
    modules: [
      {
        label: "Main workspace",
        file: "components/VoiceWorkspace.tsx",
        note: "Owns the editor + agent split-screen experience.",
      },
      {
        label: "Agent UI",
        file: "components/voice/SocraticChat.tsx",
        note: "Hosts the dialogue loop, speech controls, and clarifying question flow.",
      },
      {
        label: "Browser repo",
        file: "lib/repo-db.ts",
        note: "Stores files and metadata in IndexedDB so the editor behaves like a local workspace.",
      },
    ],
    spotlight: {
      selector: ".voice-workspace-left",
      position: "right",
      text: "This is your main split-screen workspace — editor on the left, agent chat on the right!"
    }
  },
  {
    id: "builder",
    eyebrow: "Agent Builder",
    title: "The builder is a graph of specialized agents",
    summary:
      "The core build loop is intentionally split into planner, retrieval, editing, reflection, and response phases so each agent has a narrow job and the UI can expose progress clearly.",
    highlights: [
      "Planner asks Socratic clarifying questions before acting.",
      "Retrieval narrows context instead of dumping the whole repo into a model.",
      "Reflection validates the result before the user sees the final answer.",
    ],
    builderFlow: [
      "Ingestion: voice or text enters the session state.",
      "Planning: intent classification and step generation happen here.",
      "Retrieval: relevant files are ranked before editing starts.",
      "Editing: the builder emits unified diffs, not blind rewrites.",
      "Reflection: a review pass scores the result against AWS best practices.",
      "Responding: the user gets a final answer or follow-up questions.",
    ],
    modules: [
      {
        label: "Graph orchestrator",
        file: "lib/langgraph-orchestrator.ts",
        note: "Defines the state machine and node hand-offs.",
      },
      {
        label: "Planner agent",
        file: "lib/agents/planner-agent.ts",
        note: "Uses Bedrock or Groq to create a plan or ask clarifying questions.",
      },
      {
        label: "Session store",
        file: "store/agent-store.ts",
        note: "Tracks running state, steps, messages, diffs, and clarification loops.",
      },
    ],
    spotlight: {
      selector: ".vw-chat-panel",
      position: "right",
      text: "Genie says: The LangGraph agent loop runs here!"
    }
  },
  {
    id: "surgical-edits",
    eyebrow: "Tree-sitter + Diffs",
    title: "Code changes are meant to be surgical",
    summary:
      "Instead of editing whole files blindly, the builder isolates symbols with Tree-sitter, extracts focused chunks, and generates strict unified diffs that can be validated before apply.",
    highlights: [
      "web-tree-sitter grammars are loaded dynamically from public WASM assets.",
      "Terraform uses a fallback path where no WASM grammar exists.",
      "The diff layer uses Git-style patch generation and validation.",
    ],
    modules: [
      {
        label: "AST parser",
        file: "lib/ast-parser.ts",
        note: "Loads Tree-sitter grammars and extracts symbols/chunks for targeted edits.",
      },
      {
        label: "WASM grammars",
        file: "public/tree-sitter",
        note: "Ships the browser grammar assets used by the AST layer.",
      },
      {
        label: "Diff engine",
        file: "lib/diff-engine.ts",
        note: "Creates, validates, parses, and applies unified diffs.",
      },
    ],
    spotlight: {
      selector: ".editor-area",
      position: "left",
      text: "Genie says: Code chunks map here using Web-Tree-Sitter!"
    }
  },
  {
    id: "retrieval",
    eyebrow: "Local Retrieval + Editor",
    title: "Local embeddings, fast search, and Monaco are part of the loop",
    summary:
      "This repo blends semantic retrieval, full-text indexing, and a real code editor so the agent can work with code context instead of pretending to.",
    highlights: [
      "Local Nomic embeddings run through Transformers.js via Xenova.",
      "FlexSearch provides low-latency full-text search over the in-browser repo.",
      "Monaco gives tabs, save shortcuts, breadcrumbs, syntax color, and minimap.",
    ],
    modules: [
      {
        label: "Code editor agent",
        file: "lib/agents/code-editor-agent.ts",
        note: "Runs semantic retrieval and diff generation for edits.",
      },
      {
        label: "Search engine",
        file: "lib/search-engine.ts",
        note: "Indexes repo content and serves instant path/text search.",
      },
      {
        label: "Monaco editor",
        file: "components/editor/CodeEditor.tsx",
        note: "Wraps Monaco with theming, tabs, shortcuts, and minimap.",
      },
    ],
    spotlight: {
      selector: ".workspace-sidebar",
      position: "right",
      text: "Genie says: We are using Nomic Code Embedder + FlexSearch for local retrieval right here!"
    }
  },
  {
    id: "aws",
    eyebrow: "AWS Emphasis",
    title: "AWS is not peripheral here, it is baked into the agent design",
    summary:
      "The planner, sample infra, review pass, and state types all bias toward AWS architecture work: Lambda, DynamoDB, S3, API Gateway, CloudFront, and deployment-ready infrastructure thinking.",
    highlights: [
      "Bedrock is the premium planning path and AWS Well-Architected is part of prompts.",
      "Architecture state and sample resources model AWS components explicitly.",
      "Reflection scores output against security, reliability, performance, cost, operations, and sustainability.",
    ],
    modules: [
      {
        label: "API configuration",
        file: "lib/api-config.ts",
        note: "Declares Bedrock, S3, DynamoDB, Groq, Qwen, and local model surfaces.",
      },
      {
        label: "Architecture model",
        file: "lib/langgraph-types.ts",
        note: "Encodes AWS-oriented component types like lambda, dynamodb, s3, and cloudfront.",
      },
      {
        label: "Generated infra examples",
        file: "lib/codeFiles.ts",
        note: "Contains Terraform-oriented VPC, DynamoDB, and Lambda starter outputs.",
      },
      {
        label: "Reflection agent",
        file: "lib/agents/reflection-agent.ts",
        note: "Reviews output through an AWS best-practices lens and generates docs.",
      },
    ],
    spotlight: {
      selector: ".toolbar",
      position: "bottom",
      text: "Genie says: Architecture status & AWS focus live up here!"
    }
  },
  {
    id: "voice",
    eyebrow: "Voice + Multilingual",
    title: "Voice, translation, and explanation layers round out the product",
    summary:
      "The repo is designed to ingest spoken prompts, translate across Indian languages, and explain cloud decisions back in the user’s preferred language while keeping technical AWS terms intact.",
    highlights: [
      "Mic capture is implemented with MediaRecorder and ASR provider fallback.",
      "Translation preserves technical vocabulary while switching natural language.",
      "Samjhao documentation is generated as a teaching layer, not just a raw patch summary.",
    ],
    modules: [
      {
        label: "Voice ingestion",
        file: "lib/voice-input.ts",
        note: "Handles recording, MIME negotiation, ASR, and fallback transcription.",
      },
      {
        label: "Translation service",
        file: "lib/translation-service.ts",
        note: "Routes multilingual translation with Groq fallback and Indic-focused behavior.",
      },
      {
        label: "Teaching layer",
        file: "lib/agents/reflection-agent.ts",
        note: "Produces native-language explanations and deployment docs after review.",
      },
    ],
    spotlight: {
      selector: ".vw-chat-panel",
      position: "right",
      text: "Genie says: Multilingual translations route through Groq and local STT!"
    }
  },
];