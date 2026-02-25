// ── Fake "AI" responses (Claude-powered in prod) ────────────────────────────
export const AI_RESPONSES = {
  greeting: {
    en: "Namaste! 🌿 I'm VRIKSHA, your vernacular cloud architect. I'll guide you through building production-ready AWS infrastructure using plain language — even in Hindi, Tamil, or Telugu. Let's start: **What kind of application are you building?** (e-commerce, API service, real-time chat, ML pipeline?)",
    hi: "नमस्ते! 🌿 मैं वृक्ष हूँ — आपका बादल वास्तुकार। बताइए, आप किस तरह का application बनाना चाहते हैं?",
    ta: "வணக்கம்! 🌿 நான் வ்ரிக்‌ஷா — உங்கள் cloud architect. நீங்கள் எந்த மாதிரி application உருவாக்க விரும்புகிறீர்கள்?",
  },
  ecommerce: "Great choice! 🛒 An e-commerce platform needs careful thought. Let me ask a few Socratic questions before generating any code:\n\n1. **Expected users**: 100/day or 100,000/day?\n2. **Media-heavy?** Product images, videos?\n3. **Payment processing** required (Razorpay, Stripe)?\n4. **Inventory management** needed?\n\nThese decisions will radically change whether we use RDS vs DynamoDB, CloudFront vs direct S3, and your Lambda concurrency settings.",
  database: "For your scale, I recommend **DynamoDB** over RDS. Here's why:\n\n- Serverless, no connection limits\n- Auto-scaling read/write capacity\n- Pay-per-request pricing (perfect for variable traffic)\n\nI'm generating your Terraform config now. Watch the AST Editor patch only the `dynamodb.tf` block — no other files touched! 🔬",
  deploy: "✅ Architecture finalized! Generating 4 files:\n\n- `main.tf` — VPC, subnets, security groups\n- `dynamodb.tf` — Table + GSI + replica config\n- `lambda.tf` — Functions + IAM roles\n- `next.config.js` — Frontend with API routes\n\nThe Reflection Agent will verify AWS Well-Architected compliance before you deploy.",
};

export const PIPELINE_NODES = [
  { id: 1, icon: "🎙️", title: "Vernacular Ingestion", tech: "AI4Bharat ASR", state: "done" },
  { id: 2, icon: "🧠", title: "Socratic Planner", tech: "Bedrock Claude 3.5", state: "active" },
  { id: 3, icon: "⚡", title: "AST Code Editor", tech: "Qwen Coder + Tree-sitter", state: "waiting" },
  { id: 4, icon: "🔍", title: "Reflection Agent", tech: "Gemini 3.1 Pro", state: "waiting" },
  { id: 5, icon: "🚀", title: "CI/CD Deploy", tech: "Terraform + AWS CDK", state: "waiting" },
];

export const HINT_CHIPS = [
  "Build e-commerce API",
  "Serverless REST backend",
  "Real-time chat app",
  "Make DB highly available",
  "Add CDN for images",
  "ML inference pipeline",
];