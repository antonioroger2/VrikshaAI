// ── DIFF Renderer ─────────────────────────────────────────────────────────────
const DiffBlock = ({ code }: { code: string }) => {
  const lines = code.split("\n");
  return (
    <div style={{ fontFamily: "JetBrains Mono, monospace" }}>
      {lines.map((line, i) => {
        const cls = line.startsWith("+") && !line.startsWith("+++")
          ? "diff-line diff-add"
          : line.startsWith("-") && !line.startsWith("---")
          ? "diff-line diff-rem"
          : line.startsWith("@@")
          ? "diff-line diff-hdr"
          : line.startsWith("---") || line.startsWith("+++")
          ? "diff-line diff-hdr"
          : "diff-line diff-ctx";
        return <span key={i} className={cls}>{line}{"\n"}</span>;
      })}
    </div>
  );
};

export default DiffBlock;