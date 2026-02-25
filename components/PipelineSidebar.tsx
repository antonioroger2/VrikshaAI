import { PIPELINE_NODES } from '../lib/data';

interface PipelineSidebarProps {
  nodes: typeof PIPELINE_NODES;
  stats: { files: number; lines: number; tokens: number; sessions: number };
  tokenUsed: number;
  lang: string;
}

const PipelineSidebar = ({ nodes, stats, tokenUsed, lang }: PipelineSidebarProps) => {
  return (
    <aside className="panel">
      <div className="panel-header">
        <span className="panel-title">Agent <span className="accent">Pipeline</span></span>
        <span className="tag tag-green">LangGraph</span>
      </div>
      <div className="panel-body">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.files}</div>
            <div className="stat-label">Files Generated</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.tokens}</div>
            <div className="stat-label">Tokens Used</div>
          </div>
        </div>

        <div className="token-meter" style={{ marginBottom: "1rem" }}>
          <span>Context</span>
          <div className="token-bar"><div className="token-fill" style={{ width: `${tokenUsed}%` }} /></div>
          <span>{tokenUsed}%</span>
        </div>

        <hr className="section-divider" />

        {nodes.map((node, idx) => (
          <div key={node.id}>
            <div className={`pipeline-node ${node.state}`}>
              <div className="node-icon">{node.icon}</div>
              <div className="node-text">
                <h4>{node.title}</h4>
                <p>{node.tech}</p>
              </div>
              {node.state !== "waiting" && (
                <span className={`node-status ${node.state === "active" ? "active-s" : "done-s"}`}>
                  {node.state === "active" ? "▶ running" : "✓ done"}
                </span>
              )}
            </div>
            {idx < nodes.length - 1 && <div className="pipe-connector" />}
          </div>
        ))}

        <hr className="section-divider" />

        <div className="samjhao-block">
          <div className="samjhao-title">समझाओ Layer · Samjhao</div>
          <div className="samjhao-text">
            {lang === "hi"
              ? "DynamoDB क्यों? — क्योंकि यह automatically scale होता है। आपको server manage नहीं करना पड़ेगा। किसान की तरह — बस बोओ, फसल खुद बढ़ेगी।"
              : "Why DynamoDB? — It scales automatically like a self-watering tree 🌿. No servers to manage. Pay only when used — perfect for variable rural internet traffic."}
          </div>
        </div>

        <div style={{ marginTop: "0.6rem" }}>
          <span className="tag tag-orange">Well-Architected ✓</span>
          <span className="tag tag-green">Serverless</span>
          <span className="tag tag-blue">Multi-AZ</span>
          <span className="tag tag-red">Low Latency</span>
        </div>
      </div>
    </aside>
  );
};

export default PipelineSidebar;