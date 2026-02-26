# 🌿 VRIKSHA.ai

**AI-Powered Infrastructure as Code Generator**

VRIKSHA.ai is an intelligent code generation platform that transforms natural language requirements into production-ready infrastructure code. Built with a multi-agent LangGraph pipeline, it combines voice input, AST-aware code editing, and AWS Well-Architected best practices to deliver surgical, enterprise-grade infrastructure solutions.

## ✨ Features

### 🗣️ **Multilingual Voice Input**
- **Voice Ingestion**: Record and transcribe voice commands in multiple Indian languages
- **AI4Bharat Saaras**: Industry-leading speech recognition for Hindi, Tamil, Telugu
- **Sarvam AI Fallback**: Robust transcription with automatic language detection
- **Real-time Processing**: Instant voice-to-text conversion with echo cancellation

### 🧠 **Intelligent Planning Agent**
- **Socratic Method**: Asks clarifying questions instead of making assumptions
- **Context-Aware Planning**: Analyzes existing codebase and conversation history
- **Multi-Provider Support**: Groq (Llama-3.3-70b) and Amazon Bedrock (Claude 3.5 Sonnet)
- **Vernacular-Friendly**: Responds in user's native language with technical terms in English

### 🔍 **AST-Aware Code Generation**
- **Tree-Sitter Integration**: True Abstract Syntax Tree parsing for Python, TypeScript, Go, Rust
- **Surgical Code Edits**: Precise symbol-level modifications without full rewrites
- **Vector Search**: Nomic Embed Code for semantic code retrieval
- **Unified Diff Output**: Standard patch format with 3-line context

### 🏗️ **Infrastructure Templates**
- **AWS Well-Architected**: Security, Reliability, Performance, Cost Optimization, Operations, Sustainability
- **Terraform & CDK**: Infrastructure as Code generation
- **Serverless Architecture**: Lambda, DynamoDB, API Gateway, CloudFront
- **Multi-Region Deployments**: Cross-region replicas and failover configurations

### 📋 **Code Review & Documentation**
- **Automated Code Review**: Gemini 3.1 Pro evaluates code quality and best practices
- **Samjhao Layer**: Explanations in user's native language
- **Deployment Documentation**: Production-ready deployment guides
- **Well-Architected Scoring**: 6-pillar compliance assessment

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- npm or yarn
- API Keys for AI providers (optional for local development)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/vriksha.git
   cd vriksha
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API Keys** (Optional)
   Create a `.env.local` file:
   ```env
   # AI Providers
   GROQ_API_KEY=your_groq_api_key
   BEDROCK_ACCESS_KEY=your_bedrock_key
   BEDROCK_SECRET_KEY=your_bedrock_secret
   GEMINI_API_KEY=your_gemini_key
   QWEN_API_KEY=your_qwen_key

   # Voice Services
   AI4BHARAT_API_KEY=your_ai4bharat_key
   SARVAM_API_KEY=your_sarvam_key
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

## 🏛️ Architecture

### Multi-Agent Pipeline

```
Voice Input → Planning → Retrieval → Code Editing → Reflection → Response
     ↓          ↓          ↓          ↓            ↓          ↓
  Transcribe  Socratic   Vector    AST-Aware   Code Review  Generate
  + Detect     Planning   Search    Surgery     + Docs      Response
```

### Node Descriptions

1. **Ingestion Node**: Voice recording, transcription, and language detection
2. **Planning Node**: Intent classification and execution plan generation
3. **Retrieval Node**: Semantic search across codebase using embeddings
4. **AST Parsing Node**: Tree-sitter based symbol extraction and chunking
5. **Editing Node**: Surgical code modifications with unified diff output
6. **Reflection Node**: Code review, documentation, and Well-Architected scoring

### Supported Languages

- **Programming**: Python, TypeScript/JavaScript, Go, Rust
- **Infrastructure**: HCL (Terraform), JSON, YAML
- **Voice Input**: Hindi, Tamil, Telugu, English

## 🔧 Configuration

### API Providers

VRIKSHA.ai supports multiple AI providers with automatic fallback:

| Provider | Model | Use Case |
|----------|-------|----------|
| Groq | Llama-3.3-70b | Planning, Code Generation |
| Amazon Bedrock | Claude 3.5 Sonnet | Planning, Documentation |
| Google Gemini | Gemini 3.1 Pro | Code Review, Analysis |
| Qwen | Qwen Coder | Code Editing, Diff Generation |

### Voice Services

| Service | Languages | Quality |
|---------|-----------|---------|
| AI4Bharat Saaras | Hindi, Tamil, Telugu | High |
| Sarvam AI | Hindi, Tamil, Telugu, English | High |

## 📖 Usage Examples

### Basic Infrastructure Setup
```
"Create a DynamoDB table for user data with high availability"
```

### Code Modification
```
"Add cross-region replica to my DynamoDB table for disaster recovery"
```

### Complex Architecture
```
"Build an e-commerce platform with Lambda, API Gateway, and DynamoDB"
```

### Voice Commands
Record voice in Hindi/Tamil/Telugu for natural interaction.

## 🛠️ Development

### Project Structure
```
vriksha/
├── app/                    # Next.js app directory
├── components/             # React components
│   ├── editor/            # Code editor components
│   └── VrikshaApp.tsx     # Main application
├── lib/                   # Core business logic
│   ├── agents/           # AI agent implementations
│   ├── api-config.ts     # API configuration
│   ├── ast-parser.ts     # Tree-sitter integration
│   ├── voice-input.ts    # Voice processing
│   └── langgraph-orchestrator.ts # Pipeline orchestration
├── public/               # Static assets
└── styles/              # CSS styles
```

### Key Technologies
- **Frontend**: Next.js 16, React 19, TypeScript
- **AI/ML**: Tree-sitter, WebAssembly, Vector Search
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **Build**: Turbopack

### Building for Production
```bash
npm run build
npm start
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Development Guidelines
- Use TypeScript for all new code
- Follow the existing agent pattern for new capabilities
- Add proper error handling with retry mechanisms
- Update documentation for new features

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **AI4Bharat** for speech recognition technology
- **Sarvam AI** for multilingual AI services
- **Tree-sitter** for AST parsing capabilities
- **Vercel** for hosting and deployment platform

## 📞 Support

For questions, issues, or contributions:
- Open an issue on GitHub
- Contact the maintainers
- Check the documentation for common solutions

---

**Built with ❤️ for the Indian developer community** 🇮🇳
